import { merchantKey } from './category-rules.js';
export const EXPENSE_CATEGORIES=['미분류','식비','카페','교통','주거','통신','생활용품','쇼핑','의료','문화','교육','경조사','주식','기타'];
export const INCOME_CATEGORIES=['급여','부수입','용돈','이자','기타 수입'];
const FALLBACK={expense:'미분류',income:'기타 수입',transfer:'내부 이체'};
const CAR_RENTAL=['쏘카','socar','그린카','greencar','카셰어링','카쉐어링','렌터카','렌트카','차량대여','자동차대여'];
const STOCK_MERCHANTS=['키움자동충전','키움증권','kiwoom'];
const CONTENT=[
 ['식비',['식사','식비','점심','저녁','아침','야식','도시락','삼각김밥','김밥','떡볶이','치킨','피자','햄버거','샌드위치','라면','국밥','쌀','계란','생수','우유','과일','식료품','장보기','반찬']],
 ['카페',['아메리카노','카페라떼','에스프레소','커피','카페','디저트','케이크','마카롱']],
 ['교통',['택시','버스','지하철','교통비','교통카드','승차권','주유','주차비','주차료','주차','통행료','기차','ktx','srt',...CAR_RENTAL]],
 ['주거',['월세','관리비','전기요금','수도요금','가스요금','도시가스','난방비']],
 ['통신',['통신비','통신요금','휴대폰요금','휴대폰 요금','휴대전화요금','핸드폰요금','인터넷요금','인터넷 요금']],
 ['생활용품',['치약','칫솔','샴푸','세제','휴지','화장지','쓰레기봉투','종량제봉투','비누','수세미','생활용품','주방용품']],
 ['쇼핑',['운동화','신발','청바지','티셔츠','의류','옷구입','옷 구입','옷구매','옷 구매','화장품','립스틱','가방','노트북','키보드','이어폰','전자제품']],
 ['의료',['진료','진료비','병원비','약값','처방약','감기약','약 구입','치과','건강검진','치료비','의료비']],
 ['문화',['영화','영화표','공연','뮤지컬','전시회','콘서트','넷플릭스','영화관','게임구매','게임 구매']],
 ['교육',['학원비','수강료','강의료','교재','학습지','등록금','온라인강의','온라인 강의','도서구입','도서 구입','책구매','책 구매']],
 ['경조사',['축의금','부의금','조의금','경조사']],
 ['주식',['주식',...STOCK_MERCHANTS]]
];
const MERCHANTS=[
 ['식비',['김밥천국','김밥나라','이삭토스트','한솥','본죽','맘스터치','롯데리아','버거킹','맥도날드','교촌','굽네','피자헛','배달의민족','배민','요기요','쿠팡이츠']],
 ['카페',['스타벅스','starbucks','이디야','메가커피','컴포즈커피','투썸','빽다방','커피빈','폴바셋','할리스']],
 ['교통',['카카오택시','카카오t','우티','티머니','코레일','고속버스','시외버스',...CAR_RENTAL]],
 ['주거',['한국전력','도시가스']],
 ['통신',['skt','kt통신','lg유플러스','유플러스']],
 ['쇼핑',['무신사','지그재그','에이블리','올리브영']],
 ['의료',['약국','병원','의원','치과']],
 ['문화',['cgv','메가박스','롯데시네마','넷플릭스','netflix']],
 ['교육',['교보문고','영풍문고','알라딘','yes24']],
 ['주식',STOCK_MERCHANTS]
];
const INCOME=[['급여',['급여','월급','상여','보너스']],['부수입',['외주','프리랜서','원고료','부업','부수입']],['용돈',['용돈']],['이자',['이자','예금이자','적금이자','이자입금','이자 입금']]];
const MULTI=/^(?:cu|gs25|gs더프레시|세븐일레븐|이마트24|이마트|홈플러스|롯데마트|코스트코|쿠팡|네이버|다이소|편의점)/u;
function match(text,keyword){
  const hay=String(text).normalize('NFKC').toLowerCase(),word=keyword.toLowerCase();
  if(word==='이자')return /(?:^|\s)이자(?:$|\s|입금|수입|수익)/u.test(hay);
  if(word==='주식')return /주식(?!회사)/u.test(merchantKey(hay));
  if(/^[a-z0-9]+$/.test(word))return new RegExp(`(^|[^a-z0-9])${word}(?=$|[^a-z0-9])`,'u').test(hay);
  return merchantKey(hay).includes(merchantKey(word));
}
function candidates(text,groups){return groups.filter(([,words])=>words.some(word=>match(text,word))).map(([category])=>category);}
function result(category,source,message){return {category,source,message:category==='주식'?`${message} 내 증권계좌로 옮긴 돈이면 기록 종류를 ‘내 계좌 간 이체’로 선택하면 소비 합계에서 빠져요.`:message};}
export function classify({merchant='',description='',type='expense',rules=[]}) {
  if(type==='transfer')return result('내부 이체','transfer','내 계좌 간 이체는 소비 합계에서 제외해요.');
  const key=merchantKey(merchant),saved=rules.find(rule=>rule.type===type && rule.merchantKey===key);
  if(saved)return result(saved.category,'merchant-rule','내가 기억해 둔 사용처 분류예요.');
  if(type==='income'){
    const found=candidates(`${merchant} ${description}`,INCOME);
    return found.length===1?result(found[0],'keyword','적어준 수입 내용으로 분류했어요.'):result(FALLBACK.income,'unclassified','수입 종류를 알기 어려워 기타 수입으로 남겨요.');
  }
  // Specific products take priority over a shop's usual business. A coffee
  // machine is shopping, even when purchased from a cafe or general retailer.
  const specific=[['쇼핑',['커피머신','커피 머신','휴대폰구입','휴대폰 구입','스마트폰구입','스마트폰 구입']],['생활용품',['주방세제','세탁세제']]];
  const specificProducts=candidates(description,specific);
  const rest=description.replace(/커피\s*머신|(?:휴대폰|스마트폰)\s*구입/gu,'');
  const product=[...new Set([...specificProducts,...candidates(rest,CONTENT)])];
  if(product.length>1)return result('미분류','unclassified','여러 용도가 섞여 있어요. 일단 저장하고 분류를 확인해도 돼요.');
  if(product.length===1)return result(product[0],'keyword','적어준 내용을 우선해서 분류했어요.');
  const stores=candidates(merchant,MERCHANTS);
  // General-purpose retailers should not default to food or shopping merely
  // because the merchant is known. Product text is required for a useful guess.
  const general=MULTI.test(key) && !key.startsWith('쿠팡이츠');
  const merchantContent=candidates(merchant,specific);
  const merchantRest=merchant.replace(/커피\s*머신|(?:휴대폰|스마트폰)\s*구입/gu,'');
  const words=[...new Set([...merchantContent,...candidates(merchantRest,CONTENT)])];
  if(words.length>1 || stores.length>1)return result('미분류','unclassified','어느 용도인지 확실하지 않아 미분류로 남겨요.');
  if(words.length===1)return result(words[0],'keyword','사용처에 적어준 내용으로 분류했어요.');
  if(!general && stores.length===1)return result(stores[0],'keyword','사용처를 보고 분류했어요. 틀리면 바꿀 수 있어요.');
  return result('미분류','unclassified',general?'여러 물건을 파는 곳이에요. 내용을 적으면 더 잘 분류할 수 있어요.':'아직 용도를 알기 어려워요. 미분류로도 바로 저장할 수 있어요.');
}
