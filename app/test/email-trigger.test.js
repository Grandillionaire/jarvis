'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { matchTrigger } = require('../bridge/email-bridge');

const mail = { from: '"The Boss" <boss@acme.com>', subject: 'Q3 Invoice #4412 attached' };

test('email-trigger: from-substring match (case-insensitive, addr-spec extracted)', () => {
  assert.deepEqual(matchTrigger(mail, [{ from: 'boss@acme', action: 'notify' }]), { action: 'notify' });
  assert.deepEqual(matchTrigger(mail, [{ from: 'BOSS@ACME.COM', action: 'ask' }]), { action: 'ask' });
  assert.equal(matchTrigger(mail, [{ from: 'someone-else@x.com', action: 'notify' }]), null);
});
test('email-trigger: subject-substring match', () => {
  assert.deepEqual(matchTrigger(mail, [{ subject: 'invoice', action: 'notify' }]), { action: 'notify' });
  assert.equal(matchTrigger(mail, [{ subject: 'receipt', action: 'notify' }]), null);
});
test('email-trigger: from AND subject must BOTH match when both are given', () => {
  assert.deepEqual(matchTrigger(mail, [{ from: 'boss@', subject: 'invoice', action: 'ask' }]), { action: 'ask' });
  assert.equal(matchTrigger(mail, [{ from: 'boss@', subject: 'receipt', action: 'ask' }]), null); // subject fails
  assert.equal(matchTrigger(mail, [{ from: 'nope@', subject: 'invoice', action: 'ask' }]), null); // from fails
});
test('email-trigger: first matching rule wins; later rules ignored', () => {
  assert.deepEqual(matchTrigger(mail, [{ subject: 'invoice', action: 'notify' }, { from: 'boss@', action: 'ask' }]), { action: 'notify' });
});
test('email-trigger: action defaults to notify; only "ask" is the other value', () => {
  assert.equal(matchTrigger(mail, [{ subject: 'invoice', action: 'launch_missiles' }]).action, 'notify');
  assert.equal(matchTrigger(mail, [{ subject: 'invoice' }]).action, 'notify');
});
test('email-trigger: fail-closed — empty/criterialess rules NEVER match (no fire-on-everything)', () => {
  for (const rules of [null, undefined, 'x', [], [{}], [{ action: 'notify' }], [{ from: '', subject: '' }]])
    assert.equal(matchTrigger(mail, rules), null, JSON.stringify(rules));
});
