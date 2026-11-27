var assert = require('assert');
var fs = require('fs');
var path = require('path');
var live = require('./btg-live.js');

var root = __dirname;
var week = JSON.parse(fs.readFileSync(path.join(root, 'data/btg-week11-picks.json'), 'utf8'));
var sample = JSON.parse(fs.readFileSync(path.join(root, 'data/btg-live.json'), 'utf8'));

function rowBy(board, callSign) {
  var found = null;
  board.rows.forEach(function (row) {
    if (row.callSign === callSign) found = row;
  });
  assert.ok(found, 'missing ' + callSign);
  return found;
}

assert.strictEqual(week.entries.length, 67);
assert.strictEqual(JSON.stringify(week).indexOf('@'), -1);
assert.strictEqual(JSON.stringify(sample).indexOf('@'), -1);

assert.strictEqual(live.coverMargin(14, 48, 30.5), -3.5);
assert.strictEqual(live.outcomeFromMargin(live.coverMargin(14, 48, 30.5)), 'fail');
assert.strictEqual(live.coverMargin(48, 14, -30.5), 3.5);
assert.strictEqual(live.outcomeFromMargin(0), 'push');
assert.strictEqual(live.outcomeFromMargin(live.coverMargin(10, 13, 3)), 'push');
assert.strictEqual(live.classifyStatus({ type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } }), 'pre');
assert.strictEqual(live.classifyStatus({ type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false } }), 'live');
assert.strictEqual(live.classifyStatus({ type: { name: 'STATUS_HALFTIME', state: 'in', completed: false } }), 'live');
assert.strictEqual(live.classifyStatus({ type: { name: 'STATUS_FINAL', state: 'post', completed: true } }), 'final');
assert.strictEqual(live.classifyStatus({ type: { name: 'STATUS_FINAL_OT', state: 'post', completed: true } }), 'final');

var pre = live.grade(week, live.scheduledBoard(week));
assert.strictEqual(pre.total, 67);
assert.strictEqual(pre.golfdocPoints, 0);
assert.strictEqual(pre.beating, 0);
assert.strictEqual(pre.gamesStarted, 0);
assert.strictEqual(pre.rows.length, sample.individual.length);
pre.rows.forEach(function (row, index) {
  var expected = sample.individual[index];
  assert.strictEqual(row.callSign, expected.call_sign);
  assert.strictEqual(row.rank, expected.rank);
  assert.strictEqual(row.points, 0);
  assert.strictEqual(row.live, 0);
  assert.strictEqual(row.max, 8);
  assert.strictEqual(row.vs, 0);
});
pre.games.forEach(function (game) {
  assert.strictEqual(game.phase, 'pre');
  assert.strictEqual(game.coverLabel, 'Pending');
  assert.ok(game.whenLabel.indexOf('Kickoff') === 0);
});

/* Scheduled 0-0 on the ESPN feed is not a real score. */
var pregamePayload = {
  events: [{
    date: '2026-11-14T20:30Z',
    competitions: [{
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, shortDetail: '11/14 - 3:30 PM EST' } },
      competitors: [
        { homeAway: 'home', score: '0', team: { location: 'Georgia' } },
        { homeAway: 'away', score: '0', team: { location: 'Missouri' } }
      ]
    }]
  }, {
    date: '2026-11-14T17:30Z',
    competitions: [{
      status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, shortDetail: '4:58 - 2nd' } },
      competitors: [
        { homeAway: 'home', score: '0', team: { location: 'Clemson' } },
        { homeAway: 'away', score: '10', team: { location: 'Georgia Tech' } }
      ]
    }]
  }, {
    date: '2026-11-14T20:00Z',
    competitions: [{
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, shortDetail: 'Sat' } },
      competitors: [
        { homeAway: 'home', score: '0', team: { location: 'Texas A&M' } },
        { homeAway: 'away', score: '0', team: { location: 'Tennessee' } }
      ]
    }]
  }]
};
var parsedPregame = live.parseEspn(week, pregamePayload);
assert.strictEqual(parsedPregame.g2.phase, 'pre');
assert.strictEqual(parsedPregame.g2.awayScore, null);
assert.strictEqual(parsedPregame.g2.missing, false);
assert.strictEqual(parsedPregame.g1.missing, true);
var gradedPregame = live.grade(week, parsedPregame);
assert.strictEqual(gradedPregame.rows.every(function (row) { return row.points === 0 && row.live === 0; }), true);

/* In progress 0-0 counts for LIVE* and not for official points.
   Georgia -14.5 is not covering. Missouri +14.5 is covering. */
var liveZero = live.scheduledBoard(week);
liveZero.g2 = {
  phase: 'live',
  missing: false,
  statusName: 'STATUS_IN_PROGRESS',
  detail: '15:00 - 1st',
  awayScore: 0,
  homeScore: 0
};
var tiedAtZero = live.grade(week, liveZero);
assert.strictEqual(rowBy(tiedAtZero, 'GOLFDOC').points, 0);
assert.strictEqual(rowBy(tiedAtZero, 'GOLFDOC').live, 0);
assert.strictEqual(rowBy(tiedAtZero, 'Apple').points, 0);
assert.strictEqual(rowBy(tiedAtZero, 'Apple').live, 1);
assert.strictEqual(rowBy(tiedAtZero, 'Apple').max, 8);
assert.strictEqual(rowBy(tiedAtZero, 'B Hardy').live, 1);
assert.strictEqual(tiedAtZero.games[1].coverLabel, 'Not covering · live/unofficial');
var special = null;
tiedAtZero.parlays.forEach(function (parlay) {
  if (parlay.name === 'GolfDoc Special') special = parlay;
  if (parlay.name === 'Fairway Finder') assert.strictEqual(parlay.label, 'Pending');
});
assert.strictEqual(special.label, 'Miss · live/unofficial');

/* Final scores, worked by hand:
   BC 14, ND 48.  BC +30.5: 14 - 48 + 30.5 = -3.5, does not cover. ND -30.5 covers.
   MIZ 20, UGA 38. UGA -14.5: 38 - 20 - 14.5 = 3.5, covers.
   TEX 21, LSU 24. TEX +3.5: 21 - 24 + 3.5 = 0.5, covers. LSU -3.5 does not.
   USC 17, IU 27. USC +7.5: 17 - 27 + 7.5 = -2.5, does not cover. IU -7.5 covers.
   UTAH 31, ARIZ 21. UTAH -2.5: 31 - 21 - 2.5 = 7.5, covers.
   Every parlay includes USC +7.5 or BC +30.5, so all three miss. */
var finals = {
  g1: { phase: 'final', detail: 'Final', awayScore: 14, homeScore: 48 },
  g2: { phase: 'final', detail: 'Final', awayScore: 20, homeScore: 38 },
  g3: { phase: 'final', detail: 'Final', awayScore: 21, homeScore: 24 },
  g4: { phase: 'final', detail: 'Final', awayScore: 17, homeScore: 27 },
  g5: { phase: 'final', detail: 'Final', awayScore: 31, homeScore: 21 }
};
var finalBoard = live.grade(week, finals);
assert.strictEqual(finalBoard.gamesFinal, 5);
assert.deepStrictEqual(finalBoard.games.map(function (game) { return game.coverLabel; }), [
  'Did not cover', 'Covered', 'Covered', 'Did not cover', 'Covered'
]);
assert.deepStrictEqual(finalBoard.parlays.map(function (parlay) { return parlay.label; }), ['Miss', 'Miss', 'Miss']);

/* GOLFDOC took his five sides and agreed with every parlay: 3 game points, 0 parlay points. */
assert.strictEqual(rowBy(finalBoard, 'GOLFDOC').points, 3);
assert.strictEqual(rowBy(finalBoard, 'GOLFDOC').live, 3);
assert.strictEqual(rowBy(finalBoard, 'GOLFDOC').max, 3);
assert.strictEqual(rowBy(finalBoard, 'GOLFDOC').vs, 0);
/* Apple: ND, Missouri, Texas, USC, Utah, agree/agree/agree → 1+0+1+0+1+0. */
assert.strictEqual(rowBy(finalBoard, 'Apple').points, 3);
assert.strictEqual(rowBy(finalBoard, 'Apple').vsLabel, '+0');
/* B Hardy: ND, Georgia, LSU, USC, Utah; agree, disagree, agree → 1+1+0+0+1 + 0+1+0. */
assert.strictEqual(rowBy(finalBoard, 'B Hardy').points, 4);
assert.strictEqual(rowBy(finalBoard, 'B Hardy').vsLabel, '+1');
/* Big D: BC, Georgia, LSU, USC, Utah; agree, agree, disagree → 0+1+0+0+1 + 1. */
assert.strictEqual(rowBy(finalBoard, 'Big D').points, 3);
/* GOOSE: ND, Georgia, LSU, USC, Utah; disagree all three → 1+1+0+0+1 + 3. */
assert.strictEqual(rowBy(finalBoard, 'GOOSE').points, 6);
assert.strictEqual(rowBy(finalBoard, 'GOOSE').vsLabel, '+3');
finalBoard.rows.forEach(function (row) {
  assert.ok(row.points >= 0 && row.points <= 8);
  assert.strictEqual(row.live, row.points);
  assert.strictEqual(row.max, row.points);
  assert.strictEqual(row.vs, row.points - 3);
});
assert.strictEqual(finalBoard.beating, finalBoard.rows.filter(function (row) { return row.points > 3; }).length);
assert.strictEqual(finalBoard.golfdocPoints, 3);

var seen = {};
var expectedRank = 1;
finalBoard.rows.forEach(function (row, index) {
  if (index > 0 && row.points !== finalBoard.rows[index - 1].points) expectedRank = index + 1;
  var group = finalBoard.rows.filter(function (other) { return other.points === row.points; }).length;
  var label = (group > 1 ? 'T' : '') + String(expectedRank);
  assert.strictEqual(row.rank, label);
  assert.ok(!seen[row.rank + ':' + row.callSign]);
  seen[row.rank + ':' + row.callSign] = true;
});

/* One final miss locks the parlays. The other four games are still open. */
var onlyUscFinal = live.scheduledBoard(week);
onlyUscFinal.g4 = { phase: 'final', detail: 'Final', awayScore: 17, homeScore: 27 };
var locked = live.grade(week, onlyUscFinal);
assert.strictEqual(rowBy(locked, 'GOLFDOC').points, 0);
assert.strictEqual(rowBy(locked, 'GOLFDOC').max, 4);
assert.strictEqual(rowBy(locked, 'GOOSE').points, 3);
assert.strictEqual(rowBy(locked, 'GOOSE').max, 7);
assert.strictEqual(rowBy(locked, 'B Hardy').points, 1);
assert.strictEqual(rowBy(locked, 'B Hardy').max, 5);
assert.strictEqual(locked.parlays.every(function (parlay) { return parlay.label === 'Miss'; }), true);

/* Same score while USC/Indiana is still unofficial: nothing is official yet. */
var uscLive = live.scheduledBoard(week);
uscLive.g4 = { phase: 'live', detail: '8:12 - 4th', awayScore: 17, homeScore: 27 };
var unofficial = live.grade(week, uscLive);
assert.strictEqual(unofficial.gamesFinal, 0);
assert.strictEqual(rowBy(unofficial, 'GOLFDOC').points, 0);
assert.strictEqual(rowBy(unofficial, 'GOLFDOC').live, 0);
assert.strictEqual(rowBy(unofficial, 'GOLFDOC').max, 8);
assert.strictEqual(rowBy(unofficial, 'GOOSE').points, 0);
assert.strictEqual(rowBy(unofficial, 'GOOSE').live, 3);
assert.strictEqual(rowBy(unofficial, 'GOOSE').max, 8);
assert.strictEqual(unofficial.games[3].coverLabel, 'Not covering · live/unofficial');
assert.strictEqual(unofficial.parlays[0].label, 'Miss · live/unofficial');
assert.strictEqual(unofficial.beating, 0);

/* Push, and a parlay that dies as soon as one final leg fails. */
var pushWeek = {
  week: 1,
  label: 'Week 1',
  games: [
    {
      id: 'g1', game: 'A at B', short: 'A at B', away: 'A', home: 'B', kickoff_ct: '1:00 PM CT',
      golfdoc_side: { team: 'A', spread: 3, text: 'A +3' },
      other_side: { team: 'B', spread: -3, text: 'B -3' }
    },
    {
      id: 'g2', game: 'C at D', short: 'C at D', away: 'C', home: 'D', kickoff_ct: '4:00 PM CT',
      golfdoc_side: { team: 'C', spread: -7, text: 'C -7' },
      other_side: { team: 'D', spread: 7, text: 'D +7' }
    }
  ],
  parlays: [{ parlay: 'Both', legs: ['A +3', 'C -7'] }],
  entries: [
    { call_sign: 'Agree', picks: { g1: 'A +3', g2: 'C -7' }, parlays: { Both: 'agree' } },
    { call_sign: 'Disagree', picks: { g1: 'B -3', g2: 'D +7' }, parlays: { Both: 'disagree' } },
    { call_sign: 'hidden@example.com', picks: { g1: 'A +3', g2: 'C -7' }, parlays: { Both: 'agree' }, note: 'fan@example.com' },
    { call_sign: 'GOLFDOC', picks: { g1: 'A +3', g2: 'C -7' }, parlays: { Both: 'agree' } }
  ]
};
var pushParsed = {
  g1: { phase: 'final', detail: 'Final', awayScore: 10, homeScore: 13 },
  g2: { phase: 'pre', awayScore: null, homeScore: null }
};
var pushed = live.grade(pushWeek, pushParsed);
assert.strictEqual(pushed.games[0].coverLabel, 'Push');
assert.strictEqual(pushed.parlays[0].label, 'Pending');
assert.strictEqual(rowBy(pushed, 'Agree').points, 0);
assert.strictEqual(rowBy(pushed, 'Agree').max, 1);
assert.strictEqual(rowBy(pushed, 'Disagree').points, 0);
assert.strictEqual(rowBy(pushed, 'Disagree').max, 2);
assert.strictEqual(pushed.rows.some(function (row) { return row.callSign.indexOf('@') !== -1; }), false);
assert.strictEqual(JSON.stringify(pushed).indexOf('hidden@example.com'), -1);
assert.strictEqual(JSON.stringify(pushed).indexOf('fan@example.com'), -1);

var deadParlay = {
  g1: { phase: 'final', detail: 'Final', awayScore: 10, homeScore: 20 },
  g2: { phase: 'pre', awayScore: null, homeScore: null }
};
var dead = live.grade(pushWeek, deadParlay);
assert.strictEqual(dead.games[0].coverLabel, 'Did not cover');
assert.strictEqual(dead.parlays[0].label, 'Miss');
/* A +3 loses 10-20, so B -3 covers. Disagree has that game plus the missed parlay. C at D is still open. */
assert.strictEqual(rowBy(dead, 'Agree').points, 0);
assert.strictEqual(rowBy(dead, 'Agree').max, 1);
assert.strictEqual(rowBy(dead, 'Disagree').points, 2);
assert.strictEqual(rowBy(dead, 'Disagree').max, 3);

var bothFinalPush = {
  g1: { phase: 'final', detail: 'Final', awayScore: 10, homeScore: 13 },
  g2: { phase: 'final', detail: 'Final', awayScore: 17, homeScore: 10 }
};
var allPush = live.grade(pushWeek, bothFinalPush);
assert.strictEqual(allPush.parlays[0].label, 'Push');
assert.strictEqual(rowBy(allPush, 'Agree').points, 0);
assert.strictEqual(rowBy(allPush, 'Agree').max, 0);
assert.strictEqual(rowBy(allPush, 'Disagree').points, 0);
assert.strictEqual(rowBy(allPush, 'GOLFDOC').points, 0);

var snapView = live.viewFromSnapshot(sample);
assert.strictEqual(snapView.periodic, true);
assert.strictEqual(snapView.counterText, '0 of 67 players beating the GolfDoc');
assert.strictEqual(snapView.rows.length, 67);
assert.ok(snapView.note.indexOf('Scores update periodically') !== -1);
assert.strictEqual(snapView.games.length, 5);
assert.strictEqual(snapView.games[0].coverLabel, 'Pending');

var ct = live.formatAsOfCT(new Date('2026-11-14T18:45:00Z'));
assert.strictEqual(ct, '12:45 PM CT');

function espnCheck() {
  var url = week.scores_feed;
  return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
    assert.strictEqual(res.status, 200);
    var cors = res.headers.get('access-control-allow-origin');
    assert.ok(cors === '*' || cors === 'https://golfmdvip.net' || cors === 'null' || (cors && cors.length > 0), 'CORS header missing');
    return res.json();
  }).then(function (payload) {
    var parsed = live.parseEspn(week, payload);
    week.games.forEach(function (game) {
      assert.strictEqual(parsed[game.id].missing, false, game.game);
    });
    var board = live.grade(week, parsed);
    assert.strictEqual(board.total, 67);
    var anyFinal = week.games.some(function (game) { return parsed[game.id].phase === 'final'; });
    if (!anyFinal) {
      assert.strictEqual(board.golfdocPoints, 0);
      assert.strictEqual(board.beating, 0);
      board.rows.forEach(function (row) { assert.strictEqual(row.points, 0); });
    }
    console.log('espn phases', week.games.map(function (game) {
      return game.id + ':' + parsed[game.id].phase;
    }).join(' '));
  });
}

espnCheck().then(function () {
  console.log('btg-live tests passed');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});

/* Week 13: 10 ATS picks + weighted parlays (6 / 11 / 23), max 50. */
var week13 = JSON.parse(fs.readFileSync(path.join(root, 'data/btg-week13-picks.json'), 'utf8'));
assert.strictEqual(week13.week, 13);
assert.strictEqual(week13.entries.length, 63);
assert.strictEqual(week13.games.length, 10);
assert.strictEqual(week13.parlays[0].points, 6);
assert.strictEqual(week13.parlays[1].points, 11);
assert.strictEqual(week13.parlays[2].points, 23);
assert.strictEqual(week13.scoring.max_points, 50);
assert.strictEqual(JSON.stringify(week13).indexOf('@'), -1);
assert.ok(week13.entries.some(function (entry) { return entry.call_sign === 'GOLFDOC'; }));
assert.ok(week13.entries.some(function (entry) { return entry.call_sign === 'Tennis wizard'; }));
assert.ok(week13.entries.every(function (entry) { return entry.call_sign.toLowerCase() !== 'the only colors'; }));
assert.ok(JSON.stringify(week13).toLowerCase().indexOf('matthew maier') === -1);

assert.strictEqual(live.callKind('Agree – it hits'), 'agree');
assert.strictEqual(live.callKind('Disagree – it misses'), 'disagree');
assert.strictEqual(live.callKind('disagree'), 'disagree');
assert.strictEqual(live.parlayPointValue({ points: 23 }), 23);
assert.strictEqual(live.parlayPointValue({}), 1);
assert.deepStrictEqual(live.feedUrls(week13).length, 2);

var pre13 = live.grade(week13, live.scheduledBoard(week13));
assert.strictEqual(pre13.total, 63);
assert.strictEqual(pre13.maxPoints, 50);
assert.strictEqual(pre13.golfdocPoints, 0);
assert.ok(pre13.rows.every(function (row) { return row.points === 0 && row.live === 0 && row.max === 50; }));

var liveEgg = live.scheduledBoard(week13);
liveEgg.g1 = { phase: 'live', missing: false, statusName: 'STATUS_IN_PROGRESS', detail: '12:40 - 2nd', awayScore: 0, homeScore: 3 };
var boardEgg = live.grade(week13, liveEgg);
assert.strictEqual(boardEgg.gamesStarted, 1);
assert.strictEqual(boardEgg.gamesFinal, 0);
assert.strictEqual(boardEgg.golfdocPoints, 0);
assert.strictEqual(boardEgg.golfdocLive, 1);
assert.strictEqual(rowBy(boardEgg, 'GOLFDOC').live, 1);
assert.strictEqual(rowBy(boardEgg, 'GOLFDOC').points, 0);
assert.strictEqual(rowBy(boardEgg, "Cuban’s Doc").live, 0);

var allCover = {};
week13.games.forEach(function (game) {
  var gdAway = game.golfdoc_side.team === game.away;
  allCover[game.id] = {
    phase: 'final',
    missing: false,
    statusName: 'STATUS_FINAL',
    detail: 'Final',
    awayScore: gdAway ? 40 : 0,
    homeScore: gdAway ? 0 : 40
  };
});
var sweep = live.grade(week13, allCover);
assert.strictEqual(sweep.gamesFinal, 10);
assert.strictEqual(sweep.golfdocPoints, 50);
assert.strictEqual(rowBy(sweep, 'GOLFDOC').points, 50);
assert.ok(sweep.parlays.every(function (parlay) { return parlay.status === 'hit'; }));

var snap13 = JSON.parse(fs.readFileSync(path.join(root, 'data/btg-live-week13.json'), 'utf8'));
assert.strictEqual(snap13.week, 13);
assert.strictEqual(snap13.entries, 63);
assert.strictEqual(JSON.stringify(snap13).indexOf('@'), -1);
