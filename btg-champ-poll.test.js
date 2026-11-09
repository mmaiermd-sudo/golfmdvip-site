var assert = require('assert');
var poll = require('./btg-champ-poll.js');

var mixed = poll.publicPayload({
  eventKey: 'w11_cfb_natty_2026',
  label: 'Week 11 CFB National Championship Poll',
  question: 'Who do you think is the best team in the country and will win the national championship?',
  updated: '2026-11-09T18:00:00.000Z',
  totalVoters: 4,
  results: [
    { team: 'Georgia', count: 2, pct: 50, email: 'hidden@example.com' },
    { team: 'Notre Dame', count: 1, pct: 25 },
    { team: 'fan@example.com', count: 1, pct: 25 }
  ]
});
assert.strictEqual(mixed.ok, true);
assert.deepStrictEqual(mixed.results.map(function (r) { return r.team; }), ['Notre Dame', 'Georgia', 'Other']);
assert.strictEqual(JSON.stringify(mixed).indexOf('hidden@example.com'), -1);
assert.strictEqual(JSON.stringify(mixed).indexOf('fan@example.com'), -1);
assert.strictEqual(poll.viewState(mixed), 'results');

var empty = poll.publicPayload({ eventKey: 'w11_cfb_natty_2026', totalVoters: 0, results: [] });
assert.strictEqual(poll.viewState(empty), 'empty');
assert.strictEqual(empty.results.length, 0);

var unknown = poll.publicPayload({ error: 'unknown_event', eventKey: 'masters_2027', totalVoters: 0, results: [] });
assert.strictEqual(poll.viewState(unknown), 'error');
assert.strictEqual(unknown.error, 'unknown_event');

assert.strictEqual(poll.tallyUrl('', 'w11_cfb_natty_2026', 'btgChampPoll'), '');
assert.strictEqual(
  poll.tallyUrl('https://example.invalid/exec', 'w11_cfb_natty_2026', 'btgChampPoll'),
  'https://example.invalid/exec?event=w11_cfb_natty_2026&callback=btgChampPoll'
);
assert.strictEqual(poll.tallyUrl('https://example.invalid/exec', 'w11_cfb_natty_2026', 'bad name'), '');

var pct = poll.publicPayload({
  totalVoters: 3,
  results: [{ team: 'Notre Dame', count: 1 }, { team: 'Other', count: 2 }]
});
assert.strictEqual(pct.results[0].team, 'Notre Dame');
assert.strictEqual(pct.results[0].pct, 33.3);
assert.strictEqual(pct.results[1].pct, 66.7);

console.log('btg-champ-poll tests passed');
