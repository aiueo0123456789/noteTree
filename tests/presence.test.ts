import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recentOtherSession} from '../src/presence';
test('recent opening warns only for a different session within the window',()=>{
 const now=10_000_000;
 assert.equal(recentOtherSession(null,'mine',now),false);
 assert.equal(recentOtherSession({sessionId:'mine',openedAt:now},'mine',now),false);
 assert.equal(recentOtherSession({sessionId:'other',openedAt:now-1000},'mine',now),true);
 assert.equal(recentOtherSession({sessionId:'other',openedAt:now-31*60*1000},'mine',now),false);
});
