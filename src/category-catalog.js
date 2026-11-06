import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './categorizer.js';

export const cleanCategoryName = name => typeof name === 'string' ? name.normalize('NFKC').trim().replace(/\s+/gu,' ') : '';
export const categoryIdentity = name => cleanCategoryName(name).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export const baseCategories = type => type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
export const validCategoryName = name => typeof name === 'string' && name.length > 0 && name.length <= 40 && name === cleanCategoryName(name) && /^[\p{L}\p{N}][\p{L}\p{N} ·&/().+-]*$/u.test(name);
export const customCategoryKey = category => `customCategory:${category.type}:${categoryIdentity(category.name)}`;
export function categoryOptions(type, customCategories = []) {
  return [...baseCategories(type),...customCategories.filter(category=>category.type===type).map(category=>category.name)];
}
export function validCustomCategory(category) {
  return !!category && ['expense','income'].includes(category.type) && validCategoryName(category.name)
    && categoryIdentity(category.name)!==categoryIdentity('내부 이체')
    && !baseCategories(category.type).some(name=>categoryIdentity(name)===categoryIdentity(category.name))
    && typeof category.updatedAt==='string' && Number.isFinite(Date.parse(category.updatedAt));
}
export function validCustomCategories(categories) {
  return Array.isArray(categories) && categories.length<=100 && categories.every(validCustomCategory) && new Set(categories.map(customCategoryKey)).size===categories.length;
}
export function setCustomCategory(state,key,value) {
  const categories=(state.settings.customCategories || []).filter(category=>customCategoryKey(category)!==key);
  if(value!==null){if(!validCustomCategory(value) || customCategoryKey(value)!==key)throw new Error('추가할 카테고리를 확인해주세요.');categories.push(structuredClone(value));}
  if(!validCustomCategories(categories))throw new Error('추가한 카테고리가 너무 많거나 형식이 달라요.');
  state.settings.customCategories=categories;
}
