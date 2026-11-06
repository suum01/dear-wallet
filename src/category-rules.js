export function merchantKey(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/^\s*(?:\(주\)|주식회사)\s*/u,'')
    .replace(/[^\p{L}\p{N}]/gu,'');
}
export const ruleKey = rule => `categoryRule:${rule.type}:${rule.merchantKey}`;
export function validRule(rule) {
  return !!rule && ['expense','income'].includes(rule.type)
    && typeof rule.merchantKey==='string' && rule.merchantKey.length>0 && rule.merchantKey.length<=200 && merchantKey(rule.merchantKey)===rule.merchantKey
    && typeof rule.merchantLabel==='string' && rule.merchantLabel.length<=80
    && typeof rule.category==='string' && !!rule.category.trim() && rule.category.length<=40
    && typeof rule.updatedAt==='string' && Number.isFinite(Date.parse(rule.updatedAt));
}
export function validRules(rules) {
  return Array.isArray(rules) && rules.every(validRule) && new Set(rules.map(ruleKey)).size===rules.length;
}
export function setRule(state,key,value) {
  const rules=(state.settings.categoryRules || []).filter(rule=>ruleKey(rule)!==key);
  if(value!==null){if(!validRule(value) || ruleKey(value)!==key)throw new Error('사용처 분류 규칙을 확인해주세요.');rules.push(structuredClone(value));}
  state.settings.categoryRules=rules;
}
export function findRule(state,merchant,type) {
  const key=merchantKey(merchant);
  return (state.settings.categoryRules || []).find(rule=>rule.type===type && rule.merchantKey===key) || null;
}
