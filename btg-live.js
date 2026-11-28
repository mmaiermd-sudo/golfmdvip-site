/* Beat the GolfDoc weekly live leaderboard.
   Grades call signs from the week file named by data/btg-live-week.json.
   Official points count only FINAL games. LIVE* is the total if current
   scores of started games hold. A push scores 0. Call signs only. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BTGLive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  var REFRESH_MS = 90000;

  function normTeam(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function sameTeam(a, b) {
    return normTeam(a) !== '' && normTeam(a) === normTeam(b);
  }

  function normPick(s) {
    return String(s == null ? '' : s)
      .replace(/[\u2212\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function safeCall(callSign) {
    var label = String(callSign == null ? '' : callSign).trim();
    if (!label || EMAIL_RE.test(label)) return '';
    return label;
  }

  function coverMargin(teamScore, oppScore, spread) {
    return Number(teamScore) - Number(oppScore) + Number(spread);
  }

  function outcomeFromMargin(margin) {
    if (Math.abs(margin) < 1e-9) return 'push';
    return margin > 0 ? 'cover' : 'fail';
  }

  function classifyStatus(status) {
    var type = status && status.type ? status.type : {};
    var name = String(type.name || '');
    var state = String(type.state || '');
    if (type.completed === true || name.indexOf('STATUS_FINAL') === 0) return 'final';
    if (state === 'in') return 'live';
    return 'pre';
  }

  function numScore(value) {
    if (value == null || value === '') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function competitionOf(event) {
    var list = event && event.competitions;
    return list && list.length ? list[0] : null;
  }

  function eventStatus(event) {
    var comp = competitionOf(event);
    return (comp && comp.status) || (event && event.status) || {};
  }

  function competitorsOf(event) {
    var comp = competitionOf(event);
    return (comp && comp.competitors) || [];
  }

  function competitorLocation(comp) {
    var team = (comp && comp.team) || {};
    return team.location || team.displayName || team.shortDisplayName || '';
  }

  function findEvent(events, game) {
    var wantAway = normTeam(game.away);
    var wantHome = normTeam(game.home);
    var kick = Date.parse(game.kickoff_utc || '') || 0;
    var best = null;
    var bestDist = Infinity;
    (events || []).forEach(function (event) {
      var comps = competitorsOf(event);
      var away = null;
      var home = null;
      comps.forEach(function (comp) {
        var loc = normTeam(competitorLocation(comp));
        if (loc === wantAway) away = comp;
        if (loc === wantHome) home = comp;
      });
      if (!away || !home || away === home) return;
      var when = Date.parse(event.date || '') || 0;
      var dist = kick && when ? Math.abs(when - kick) : 0;
      if (!best || dist < bestDist) {
        best = { event: event, away: away, home: home };
        bestDist = dist;
      }
    });
    return best;
  }

  function parseEspn(week, payload) {
    var events = payload && payload.events ? payload.events : [];
    var byId = {};
    (week.games || []).forEach(function (game) {
      var hit = findEvent(events, game);
      if (!hit) {
        byId[game.id] = {
          phase: 'pre',
          missing: true,
          statusName: '',
          detail: '',
          awayScore: null,
          homeScore: null
        };
        return;
      }
      var status = eventStatus(hit.event);
      var type = status.type || {};
      var phase = classifyStatus(status);
      var usable = phase === 'live' || phase === 'final';
      byId[game.id] = {
        phase: phase,
        missing: false,
        statusName: String(type.name || ''),
        detail: String(type.shortDetail || type.detail || ''),
        awayScore: usable ? numScore(hit.away.score) : null,
        homeScore: usable ? numScore(hit.home.score) : null
      };
    });
    return byId;
  }

  function scheduledBoard(week) {
    var byId = {};
    (week.games || []).forEach(function (game) {
      byId[game.id] = {
        phase: 'pre',
        missing: false,
        statusName: 'STATUS_SCHEDULED',
        detail: '',
        awayScore: null,
        homeScore: null
      };
    });
    return byId;
  }

  function resolveSide(game, pickText) {
    var n = normPick(pickText);
    if (!n) return null;
    if (game.golfdoc_side && n === normPick(game.golfdoc_side.text)) return game.golfdoc_side;
    if (game.other_side && n === normPick(game.other_side.text)) return game.other_side;
    var cleaned = String(pickText || '').replace(/[\u2212\u2013\u2014]/g, '-').trim();
    var match = cleaned.match(/^(.*?)([+-]\d+(?:\.\d+)?)$/);
    if (!match) return null;
    var team = match[1].trim();
    var spread = Number(match[2]);
    if (game.golfdoc_side && sameTeam(team, game.golfdoc_side.team) && Number(game.golfdoc_side.spread) === spread) {
      return game.golfdoc_side;
    }
    if (game.other_side && sameTeam(team, game.other_side.team) && Number(game.other_side.spread) === spread) {
      return game.other_side;
    }
    return null;
  }

  function teamScore(game, parsedGame, team) {
    if (!parsedGame || parsedGame.awayScore == null || parsedGame.homeScore == null) return null;
    if (sameTeam(team, game.away)) return parsedGame.awayScore;
    if (sameTeam(team, game.home)) return parsedGame.homeScore;
    return null;
  }

  function opponentName(game, team) {
    if (sameTeam(team, game.away)) return game.home;
    if (sameTeam(team, game.home)) return game.away;
    return '';
  }

  function sideOutcome(game, parsedGame, side) {
    if (!side) return 'none';
    var phase = parsedGame ? parsedGame.phase : 'pre';
    if (phase !== 'live' && phase !== 'final') return 'pending';
    var mine = teamScore(game, parsedGame, side.team);
    var opp = teamScore(game, parsedGame, opponentName(game, side.team));
    if (mine == null || opp == null) return 'pending';
    return outcomeFromMargin(coverMargin(mine, opp, side.spread));
  }

  /* Official calls ignore anything that is not final.
     Live calls treat an in-progress score as if it holds. */
  function countedOutcome(outcome, phase, mode) {
    if (outcome === 'none') return 'none';
    var counts = mode === 'official' ? phase === 'final' : (phase === 'final' || phase === 'live');
    if (!counts || outcome === 'pending') return 'pending';
    return outcome;
  }

  function gameForLeg(week, legText) {
    var n = normPick(legText);
    var games = week.games || [];
    for (var i = 0; i < games.length; i++) {
      if (games[i].golfdoc_side && normPick(games[i].golfdoc_side.text) === n) return games[i];
    }
    return null;
  }

  function legOutcome(week, parsed, legText, mode) {
    var game = gameForLeg(week, legText);
    if (!game) return 'pending';
    var parsedGame = parsed[game.id] || { phase: 'pre' };
    var raw = sideOutcome(game, parsedGame, game.golfdoc_side);
    return countedOutcome(raw, parsedGame.phase || 'pre', mode);
  }

  function parlayState(legOutcomes) {
    var anyFail = false;
    var anyPending = false;
    var anyPush = false;
    legOutcomes.forEach(function (outcome) {
      if (outcome === 'fail') anyFail = true;
      else if (outcome === 'pending') anyPending = true;
      else if (outcome === 'push') anyPush = true;
    });
    if (anyFail) return 'miss';
    if (anyPending) return 'pending';
    if (anyPush) return 'push';
    if (!legOutcomes.length) return 'pending';
    return 'hit';
  }

  function callKind(value) {
    var kind = String(value == null ? '' : value).trim().toLowerCase();
    /* Check disagree first: "disagree" contains the letters "agree". */
    if (/^disagree\b/.test(kind) || kind === 'disagree') return 'disagree';
    if (/^agree\b/.test(kind) || kind === 'agree') return 'agree';
    return '';
  }

  function parlayPointValue(parlay) {
    var n = parlay && parlay.points != null ? Number(parlay.points) : 1;
    return isFinite(n) && n > 0 ? n : 1;
  }

  function pointsForParlay(state, kind, pts) {
    var value = pts == null ? 1 : Number(pts);
    if (!isFinite(value) || value < 0) value = 1;
    /* Agree scores the parlay's point value only if it hits.
       Disagree scores 1 point only if it misses — never the odds-based parlay value. */
    if (state === 'hit' && kind === 'agree') return value;
    if (state === 'miss' && kind === 'disagree') return 1;
    return 0;
  }

  function parlayStillPossible(state, legOutcomes, kind, pts) {
    var value = pts == null ? 1 : Number(pts);
    if (!isFinite(value) || value < 0) value = 1;
    if (kind !== 'agree' && kind !== 'disagree') return 0;
    if (state !== 'pending') return 0;
    if (kind === 'agree') {
      var blocked = legOutcomes.some(function (outcome) { return outcome === 'push'; });
      return blocked ? 0 : value;
    }
    return 1;
  }

  function scoreEntry(week, parsed, entry) {
    var points = 0;
    var live = 0;
    var possible = 0;
    var picks = entry && entry.picks ? entry.picks : {};
    var parlays = entry && entry.parlays ? entry.parlays : {};

    (week.games || []).forEach(function (game) {
      var side = resolveSide(game, picks[game.id]);
      var parsedGame = parsed[game.id] || { phase: 'pre' };
      var phase = parsedGame.phase || 'pre';
      var raw = sideOutcome(game, parsedGame, side);
      var official = countedOutcome(raw, phase, 'official');
      var projected = countedOutcome(raw, phase, 'live');
      if (official === 'cover') points += 1;
      if (projected === 'cover') live += 1;
      if (official === 'pending') possible += 1;
    });

    (week.parlays || []).forEach(function (parlay) {
      var legs = parlay.legs || [];
      var pts = parlayPointValue(parlay);
      var officialLegs = legs.map(function (leg) { return legOutcome(week, parsed, leg, 'official'); });
      var liveLegs = legs.map(function (leg) { return legOutcome(week, parsed, leg, 'live'); });
      var officialState = parlayState(officialLegs);
      var liveState = parlayState(liveLegs);
      var kind = callKind(parlays[parlay.parlay]);
      points += pointsForParlay(officialState, kind, pts);
      live += pointsForParlay(liveState, kind, pts);
      possible += parlayStillPossible(officialState, officialLegs, kind, pts);
    });

    return {
      points: points,
      live: live,
      max: points + possible
    };
  }

  function golfDocEntry(week) {
    var entries = week.entries || [];
    for (var i = 0; i < entries.length; i++) {
      if (normTeam(entries[i].call_sign) === 'golfdoc') return entries[i];
    }
    var picks = {};
    (week.games || []).forEach(function (game) {
      picks[game.id] = game.golfdoc_side ? game.golfdoc_side.text : '';
    });
    var parlays = {};
    (week.parlays || []).forEach(function (parlay) {
      parlays[parlay.parlay] = 'agree';
    });
    return { call_sign: 'GOLFDOC', picks: picks, parlays: parlays, synthetic: true };
  }

  function assignRanks(rows) {
    var i = 0;
    while (i < rows.length) {
      var points = rows[i].points;
      var j = i + 1;
      while (j < rows.length && rows[j].points === points) j++;
      var rank = i + 1;
      var label = (j - i > 1 ? 'T' : '') + String(rank);
      for (var k = i; k < j; k++) rows[k].rank = label;
      i = j;
    }
    return rows;
  }

  function shortSides(game) {
    var parts = String(game.short || '').split(/\s+at\s+/i);
    if (parts.length === 2) return { away: parts[0].trim(), home: parts[1].trim() };
    return { away: game.away, home: game.home };
  }

  function whenLabel(game, parsedGame) {
    var phase = parsedGame.phase || 'pre';
    var detail = parsedGame.detail || '';
    if (phase === 'final') return detail || 'Final';
    if (phase === 'live') return (detail || 'In progress') + ' · live/unofficial';
    if (parsedGame.statusName && parsedGame.statusName !== 'STATUS_SCHEDULED' && detail) return detail;
    return 'Kickoff ' + (game.kickoff_ct || '');
  }

  function scoreLabel(game, parsedGame) {
    if (!parsedGame || parsedGame.awayScore == null || parsedGame.homeScore == null) return '—';
    var sides = shortSides(game);
    return sides.away + ' ' + parsedGame.awayScore + ' · ' + sides.home + ' ' + parsedGame.homeScore;
  }

  function coverLabel(phase, outcome) {
    if (phase !== 'live' && phase !== 'final') return 'Pending';
    if (outcome === 'pending' || outcome === 'none') return 'Pending';
    if (outcome === 'cover') return phase === 'final' ? 'Covered' : 'Covering · live/unofficial';
    if (outcome === 'push') return phase === 'final' ? 'Push' : 'Push · live/unofficial';
    return phase === 'final' ? 'Did not cover' : 'Not covering · live/unofficial';
  }

  function parlayLabel(officialState, liveState) {
    if (officialState === 'hit') return 'Hit';
    if (officialState === 'miss') return 'Miss';
    if (officialState === 'push') return 'Push';
    if (liveState === 'hit') return 'Hit · live/unofficial';
    if (liveState === 'miss') return 'Miss · live/unofficial';
    if (liveState === 'push') return 'Push · live/unofficial';
    return 'Pending';
  }

  function formatVs(n) {
    if (n > 0) return '+' + n;
    if (n < 0) return String(n);
    return '+0';
  }

  function grade(week, parsed) {
    var doc = golfDocEntry(week);
    var docScore = scoreEntry(week, parsed, doc);
    var rows = [];
    (week.entries || []).forEach(function (entry, index) {
      var callSign = safeCall(entry && entry.call_sign);
      if (!callSign) return;
      var scored = scoreEntry(week, parsed, entry);
      rows.push({
        order: index,
        callSign: callSign,
        points: scored.points,
        live: scored.live,
        max: scored.max,
        vs: scored.points - docScore.points,
        isGolfDoc: normTeam(callSign) === 'golfdoc'
      });
    });
    rows.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      if (b.live !== a.live) return b.live - a.live;
      return a.order - b.order;
    });
    assignRanks(rows);

    var games = (week.games || []).map(function (game) {
      var parsedGame = parsed[game.id] || { phase: 'pre', awayScore: null, homeScore: null, detail: '' };
      var raw = sideOutcome(game, parsedGame, game.golfdoc_side);
      return {
        id: game.id,
        matchup: game.game,
        short: game.short || game.game,
        golfdocPick: game.golfdoc_side ? game.golfdoc_side.text : '',
        kickoff: game.kickoff_ct || '',
        phase: parsedGame.phase || 'pre',
        whenLabel: whenLabel(game, parsedGame),
        scoreLabel: scoreLabel(game, parsedGame),
        cover: raw,
        coverLabel: coverLabel(parsedGame.phase || 'pre', raw)
      };
    });

    var parlays = (week.parlays || []).map(function (parlay) {
      var legs = parlay.legs || [];
      var officialState = parlayState(legs.map(function (leg) { return legOutcome(week, parsed, leg, 'official'); }));
      var liveState = parlayState(legs.map(function (leg) { return legOutcome(week, parsed, leg, 'live'); }));
      return {
        name: parlay.parlay,
        status: officialState,
        liveStatus: liveState,
        label: parlayLabel(officialState, liveState)
      };
    });

    var beating = 0;
    rows.forEach(function (row) {
      if (row.points > docScore.points) beating += 1;
    });
    var finals = games.filter(function (game) { return game.phase === 'final'; }).length;
    var started = games.filter(function (game) { return game.phase === 'live' || game.phase === 'final'; }).length;
    var maxPoints = (week.games || []).length;
    (week.parlays || []).forEach(function (parlay) { maxPoints += parlayPointValue(parlay); });
    if (week.scoring && week.scoring.max_points != null && isFinite(Number(week.scoring.max_points))) {
      maxPoints = Number(week.scoring.max_points);
    }

    return {
      week: week.week,
      label: week.label || ('Week ' + week.week),
      golfdocPoints: docScore.points,
      golfdocLive: docScore.live,
      beating: beating,
      total: rows.length,
      maxPoints: maxPoints,
      gamesFinal: finals,
      gamesStarted: started,
      games: games,
      parlays: parlays,
      rows: rows.map(function (row) {
        return {
          rank: row.rank,
          callSign: row.callSign,
          points: row.points,
          live: row.live,
          max: row.max,
          vs: row.vs,
          vsLabel: formatVs(row.vs),
          isGolfDoc: row.isGolfDoc
        };
      })
    };
  }

  function formatAsOfCT(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).formatToParts(date);
    var hour = '';
    var minute = '';
    var dayPeriod = '';
    parts.forEach(function (part) {
      if (part.type === 'hour') hour = part.value;
      if (part.type === 'minute') minute = part.value;
      if (part.type === 'dayPeriod') dayPeriod = String(part.value || '').toUpperCase();
    });
    return hour + ':' + minute + ' ' + dayPeriod + ' CT';
  }

  function boardView(board, asOfLabel, periodic) {
    var note;
    if (periodic) {
      note = 'Scores update periodically. Official points count a game only after it is final. LIVE* is unofficial.';
    } else if (!board.gamesStarted) {
      note = 'Before kickoff everyone is at 0. Official points count a game only after it is final. LIVE* is the total if the current score holds.';
    } else if (!board.gamesFinal) {
      note = 'Official points stay at 0 until a game is final. LIVE* is unofficial and counts the current score as if it holds. A push scores 0.';
    } else {
      var maxPoints = board.maxPoints != null ? board.maxPoints : 8;
      note = 'Official points count final games only. LIVE* is unofficial for any game still in progress. A push scores 0. Max is ' + maxPoints + '.';
    }
    return {
      label: board.label,
      asOfLabel: asOfLabel,
      periodic: !!periodic,
      counterText: board.beating + ' of ' + board.total + ' players beating the GolfDoc',
      golfdocPoints: board.golfdocPoints,
      beating: board.beating,
      total: board.total,
      games: board.games,
      parlays: board.parlays,
      rows: board.rows,
      note: note
    };
  }

  function snapshotCoverLabel(side, state) {
    var value = String(side || 'pending').toLowerCase();
    var live = String(state || '').toUpperCase() !== 'FINAL' && String(state || '').toUpperCase() !== 'NOT STARTED';
    if (value === 'pending' || value === '') return 'Pending';
    if (value === 'cover' || value === 'covering' || value === 'covered') {
      if (String(state || '').toUpperCase() === 'FINAL' || value === 'covered') return 'Covered';
      return 'Covering · live/unofficial';
    }
    if (value === 'push') return live ? 'Push · live/unofficial' : 'Push';
    if (value === 'fail' || value === 'miss' || value === 'missed' || value === 'not covering' || value === 'did not cover') {
      if (String(state || '').toUpperCase() === 'FINAL' || value === 'did not cover') return 'Did not cover';
      return 'Not covering · live/unofficial';
    }
    return side;
  }

  function viewFromSnapshot(snapshot) {
    var games = (snapshot.games || []).map(function (game) {
      var state = game.state || 'NOT STARTED';
      return {
        id: game.short || game.game,
        matchup: game.game,
        short: game.short || game.game,
        golfdocPick: game.golfdoc_pick || '',
        kickoff: game.kickoff || '',
        phase: String(state).toUpperCase() === 'FINAL' ? 'final' : (String(state).toUpperCase() === 'NOT STARTED' ? 'pre' : 'live'),
        whenLabel: game.detail || game.kickoff || state,
        scoreLabel: game.score ? game.score : '—',
        cover: game.golfdoc_side || 'pending',
        coverLabel: snapshotCoverLabel(game.golfdoc_side, state)
      };
    });
    var parlays = [];
    var rawParlays = snapshot.parlays || {};
    Object.keys(rawParlays).forEach(function (name) {
      var item = rawParlays[name] || {};
      var status = String(item.status || 'PENDING');
      var held = String(item.if_current_scores_hold || status);
      var label = status.toUpperCase() === 'PENDING' && held.toUpperCase() !== 'PENDING'
        ? held + ' · live/unofficial'
        : status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
      parlays.push({ name: name, status: status.toLowerCase(), liveStatus: held.toLowerCase(), label: label });
    });
    var rows = [];
    (snapshot.individual || []).forEach(function (row) {
      var callSign = safeCall(row.call_sign);
      if (!callSign) return;
      var vs = Number(row.vs_golfdoc) || 0;
      rows.push({
        rank: String(row.rank),
        callSign: callSign,
        points: Number(row.points) || 0,
        live: Number(row.live_points_if_current_scores_hold) || 0,
        max: Number(row.max_possible) || 0,
        vs: vs,
        vsLabel: formatVs(vs),
        isGolfDoc: normTeam(callSign) === 'golfdoc'
      });
    });
    var total = rows.length;
    var beating = Number(snapshot.beating_golfdoc);
    if (!isFinite(beating)) beating = 0;
    return {
      label: snapshot.title || ('Week ' + snapshot.week),
      asOfLabel: snapshot.as_of || '',
      periodic: true,
      counterText: beating + ' of ' + total + ' players beating the GolfDoc',
      golfdocPoints: Number(snapshot.golfdoc_points) || 0,
      beating: beating,
      total: total,
      games: games,
      parlays: parlays,
      rows: rows,
      note: 'Scores update periodically. Official points count a game only after it is final. LIVE* is unofficial.'
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(root, view) {
    var title = root.querySelector('[data-btg-live="title"]');
    var asOf = root.querySelector('[data-btg-live="asof"]');
    var counter = root.querySelector('[data-btg-live="counter"]');
    var games = root.querySelector('[data-btg-live="games"]');
    var parlays = root.querySelector('[data-btg-live="parlays"]');
    var note = root.querySelector('[data-btg-live="note"]');
    var weekMatch = String(view.label || '').match(/Week\s+\d+/i);
    var weekName = weekMatch ? weekMatch[0] : 'This week';
    if (title) title.textContent = weekName + ' live leaderboard';
    var caption = root.querySelector('.btg-live-table caption');
    if (caption) caption.textContent = weekName + ' individual standings. Call signs only.';
    if (asOf) {
      var prefix = 'As of ' + view.asOfLabel;
      asOf.textContent = view.periodic ? prefix + '. Scores update periodically.' : prefix + '.';
    }
    if (counter) {
      counter.innerHTML = '<span>' + escapeHtml(view.counterText) + '</span>'
        + '<small>GolfDoc ' + escapeHtml(String(view.golfdocPoints)) + '</small>';
    }
    if (games) {
      games.innerHTML = view.games.map(function (game) {
        return '<article class="btg-live-game" data-phase="' + escapeHtml(game.phase) + '">'
          + '<h3>' + escapeHtml(game.short || game.matchup) + '</h3>'
          + '<p class="btg-live-match">' + escapeHtml(game.matchup) + '</p>'
          + '<p class="btg-live-pick">GolfDoc: ' + escapeHtml(game.golfdocPick) + '</p>'
          + '<p class="btg-live-when">' + escapeHtml(game.whenLabel) + '</p>'
          + '<p class="btg-live-score">' + escapeHtml(game.scoreLabel) + '</p>'
          + '<p class="btg-live-cover" data-cover="' + escapeHtml(game.cover) + '">' + escapeHtml(game.coverLabel) + '</p>'
          + '</article>';
      }).join('');
    }
    if (parlays) {
      parlays.innerHTML = view.parlays.map(function (parlay) {
        return '<p class="btg-live-parlay"><strong>' + escapeHtml(parlay.name) + '</strong> ' + escapeHtml(parlay.label) + '</p>';
      }).join('');
    }
    if (note) note.textContent = view.note + ' Call signs only.';
    root._btgView = view;
    applyFilter(root);
  }

  function applyFilter(root) {
    var view = root._btgView;
    var body = root.querySelector('[data-btg-live="rows"]');
    var filterEl = root.querySelector('[data-btg-live="filter"]');
    var countEl = root.querySelector('[data-btg-live="filter-count"]');
    if (!view || !body) return;
    var query = filterEl ? String(filterEl.value || '').trim().toLowerCase() : '';
    var shown = 0;
    var html = view.rows.filter(function (row) {
      return !query || row.callSign.toLowerCase().indexOf(query) !== -1;
    }).map(function (row) {
      shown += 1;
      var cls = row.isGolfDoc ? 'btg-live-gd' : (row.vs > 0 ? 'btg-live-ahead' : '');
      return '<tr class="' + cls + '">'
        + '<td>' + escapeHtml(row.rank) + '</td>'
        + '<td>' + escapeHtml(row.callSign) + '</td>'
        + '<td><strong>' + escapeHtml(String(row.points)) + '</strong></td>'
        + '<td>' + escapeHtml(String(row.live)) + '</td>'
        + '<td>' + escapeHtml(String(row.max)) + '</td>'
        + '<td>' + escapeHtml(row.vsLabel) + '</td>'
        + '</tr>';
    }).join('');
    if (!html) {
      body.innerHTML = '<tr><td colspan="6">' + (query ? 'No call signs match.' : 'No entries yet.') + '</td></tr>';
    } else {
      body.innerHTML = html;
    }
    if (countEl) {
      countEl.textContent = query ? ('Showing ' + shown + ' of ' + view.rows.length) : '';
    }
  }

  function bust(url) {
    var join = url.indexOf('?') >= 0 ? '&' : '?';
    return url + join + 't=' + Date.now();
  }

  function fetchJson(url, sameSite) {
    return fetch(sameSite ? bust(url) : url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function mergeEspnPayloads(payloads) {
    var events = [];
    var seen = {};
    (payloads || []).forEach(function (payload) {
      ((payload && payload.events) || []).forEach(function (event) {
        var id = String((event && event.id) || '');
        if (id && seen[id]) return;
        if (id) seen[id] = true;
        events.push(event);
      });
    });
    return { events: events };
  }

  function feedUrls(week) {
    var feeds = week && week.scores_feeds;
    if (Array.isArray(feeds) && feeds.length) return feeds.filter(Boolean);
    var feed = week && week.scores_feed;
    if (Array.isArray(feed)) return feed.filter(Boolean);
    if (typeof feed === 'string' && feed) return [feed];
    return [];
  }

  function start(options) {
    if (typeof document === 'undefined') return;
    var opts = options || {};
    var root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root;
    if (!root) root = document.getElementById('live');
    if (!root || root.getAttribute('data-btg-started') === '1') return;
    root.setAttribute('data-btg-started', '1');
    var pointerUrl = opts.pointerUrl || root.getAttribute('data-pointer') || 'data/btg-live-week.json';
    var refreshMs = Number(opts.refreshMs) || REFRESH_MS;
    if (refreshMs < 60000) refreshMs = 60000;
    if (refreshMs > 120000) refreshMs = 120000;
    var asOf = root.querySelector('[data-btg-live="asof"]');
    var refreshBtn = root.querySelector('[data-btg-live="refresh"]');
    var filterEl = root.querySelector('[data-btg-live="filter"]');
    var inFlight = false;
    var timer = 0;

    function showError(message) {
      root.setAttribute('data-source', 'error');
      if (asOf) asOf.textContent = message;
    }

    function load() {
      if (inFlight) return;
      inFlight = true;
      if (refreshBtn) refreshBtn.disabled = true;
      fetchJson(pointerUrl, true).then(function (pointer) {
        var picksUrl = pointer && pointer.picks;
        if (!picksUrl) throw new Error('missing picks');
        return fetchJson(picksUrl, true).then(function (week) {
          return { pointer: pointer, week: week };
        });
      }).then(function (loaded) {
        var urls = feedUrls(loaded.week);
        if (!urls.length) throw new Error('missing feed');
        return Promise.all(urls.map(function (url) { return fetchJson(url, false); })).then(function (payloads) {
          var parsed = parseEspn(loaded.week, mergeEspnPayloads(payloads));
          var matched = (loaded.week.games || []).some(function (game) {
            return parsed[game.id] && !parsed[game.id].missing;
          });
          if (!matched) throw new Error('no matched games');
          var board = grade(loaded.week, parsed);
          root.setAttribute('data-source', 'espn');
          root.removeAttribute('data-espn-error');
          render(root, boardView(board, formatAsOfCT(new Date()), false));
        }).catch(function (err) {
          root.setAttribute('data-espn-error', String(err && err.message ? err.message : err));
          var snapshotUrl = loaded.pointer && loaded.pointer.snapshot;
          if (!snapshotUrl) throw new Error('no snapshot');
          return fetchJson(snapshotUrl, true).then(function (snapshot) {
            root.setAttribute('data-source', 'snapshot');
            var asOfLabel = snapshot.as_of || formatAsOfCT(new Date());
            render(root, viewFromSnapshot(snapshot));
            if (asOf && asOfLabel) {
              asOf.textContent = 'As of ' + asOfLabel + '. Scores update periodically.';
            }
          });
        });
      }).catch(function () {
        if (!root._btgView) showError('Live scores are unavailable right now. Scores update periodically.');
        else if (asOf) asOf.textContent = 'Could not refresh. Showing the last update. Scores update periodically.';
      }).then(function () {
        inFlight = false;
        if (refreshBtn) refreshBtn.disabled = false;
      });
    }

    if (filterEl) filterEl.addEventListener('input', function () { applyFilter(root); });
    if (refreshBtn) refreshBtn.addEventListener('click', load);
    load();
    timer = setInterval(load, refreshMs);
    root._btgStop = function () { clearInterval(timer); };
  }

  return {
    normTeam: normTeam,
    coverMargin: coverMargin,
    outcomeFromMargin: outcomeFromMargin,
    classifyStatus: classifyStatus,
    parseEspn: parseEspn,
    mergeEspnPayloads: mergeEspnPayloads,
    feedUrls: feedUrls,
    scheduledBoard: scheduledBoard,
    grade: grade,
    callKind: callKind,
    parlayPointValue: parlayPointValue,
    pointsForParlay: pointsForParlay,
    parlayStillPossible: parlayStillPossible,
    formatAsOfCT: formatAsOfCT,
    formatVs: formatVs,
    viewFromSnapshot: viewFromSnapshot,
    boardView: boardView,
    start: start,
    applyFilter: applyFilter
  };
});
