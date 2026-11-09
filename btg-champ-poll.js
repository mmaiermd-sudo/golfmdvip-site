/* Combined championship-poll totals.
   Public aggregates only. The Apps Script endpoint dedupes by email.
   This file never displays identity fields. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BTGChampPoll = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var CALLBACK_RE = /^[A-Za-z_$][\w.$]*$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function orderResults(results) {
    var nd = [];
    var rest = [];
    (results || []).forEach(function (row) {
      if (String(row.team).trim().toLowerCase() === 'notre dame') nd.push(row);
      else rest.push(row);
    });
    return nd.concat(rest);
  }

  function publicTeam(team) {
    var label = String(team == null ? '' : team).trim();
    if (!label) return '';
    if (EMAIL_RE.test(label)) return 'Other';
    return label;
  }

  function publicPayload(raw) {
    var data = raw && typeof raw === 'object' ? raw : {};
    if (data.error) {
      return {
        ok: false,
        error: String(data.error),
        eventKey: data.eventKey ? String(data.eventKey) : '',
        totalVoters: 0,
        results: []
      };
    }
    var results = [];
    if (Array.isArray(data.results)) {
      data.results.forEach(function (row) {
        if (!row || typeof row !== 'object') return;
        var team = publicTeam(row.team);
        var count = Number(row.count);
        if (!team || !isFinite(count) || count < 0) return;
        var pct = Number(row.pct);
        results.push({
          team: team,
          count: count,
          pct: isFinite(pct) ? pct : null
        });
      });
    }
    var total = Number(data.totalVoters);
    if (!isFinite(total) || total < 0) {
      total = results.reduce(function (sum, row) { return sum + row.count; }, 0);
    }
    results.forEach(function (row) {
      if (row.pct == null) row.pct = total ? Math.round(1000 * row.count / total) / 10 : 0;
    });
    return {
      ok: true,
      eventKey: data.eventKey ? String(data.eventKey) : '',
      label: data.label ? String(data.label) : '',
      question: data.question ? String(data.question) : '',
      updated: data.updated ? String(data.updated) : '',
      totalVoters: total,
      results: orderResults(results)
    };
  }

  function viewState(payload) {
    if (!payload || !payload.ok) return 'error';
    if (!payload.totalVoters || !payload.results.length) return 'empty';
    return 'results';
  }

  function tallyUrl(endpoint, eventKey, callbackName) {
    if (!endpoint || !CALLBACK_RE.test(callbackName)) return '';
    var join = endpoint.indexOf('?') >= 0 ? '&' : '?';
    return endpoint + join + 'event=' + encodeURIComponent(eventKey || '') + '&callback=' + encodeURIComponent(callbackName);
  }

  return {
    orderResults: orderResults,
    publicPayload: publicPayload,
    viewState: viewState,
    tallyUrl: tallyUrl
  };
});
