/** A recent opening is a hint, not a live presence/lock guarantee. */
export function recentOtherSession(record:{sessionId:string;openedAt:number}|null,sessionId:string,now=Date.now()):boolean {
  return !!record && record.sessionId!==sessionId && Number.isFinite(record.openedAt) && record.openedAt>now-30*60*1000;
}
