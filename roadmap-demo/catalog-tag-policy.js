import { DETAILED_INDUSTRY_OPTIONS, INDUSTRY_OPTIONS, NON_INDUSTRY_OPTIONS } from "./catalog-options.js";

const nonIndustryTags = new Set(NON_INDUSTRY_OPTIONS);
const weakIndustryMatchers = new Map([
  ["데이터", /(?:데이터\s*(?:산업|기업|기반|활용|분석)|공공데이터|빅데이터)/i],
  ["디자인", /(?:디자인\s*(?:산업|기업|전문|제품|콘텐츠)|산업디자인)/i],
  ["디지털", /(?:디지털\s*(?:산업|기업|기술|전환|콘텐츠)|DX\b)/i],
  ["서비스", /(?:서비스업|서비스\s*(?:산업|기업|플랫폼))/i],
  ["소재", /(?:첨단소재|신소재|소재\s*(?:산업|기술|개발)|소재[ㆍ·/]?부품)/i],
  ["솔루션", /(?:솔루션\s*(?:기업|산업|개발)|산업용\s*솔루션)/i],
  ["플랫폼", /(?:플랫폼\s*(?:기업|산업|서비스|개발)|온라인\s*플랫폼)/i],
]);

const semanticIndustrySignals = Object.freeze([
  ["AI", /\bAI\b|인공지능/i], ["로봇", /로봇/], ["반도체", /반도체/],
  ["이차전지", /이차전지|2차전지|배터리/], ["자동차", /자동차|미래차|전기차/],
  ["우주항공", /우주|항공|위성/], ["방위산업", /방산|방위산업/], ["조선", /조선|선박/],
  ["해양수산", /해양수산|수산업|어업/], ["바이오", /바이오|생명공학/],
  ["헬스케어", /헬스케어|의료|메디컬|병원/], ["의료기기", /의료기기/],
  ["제약바이오", /제약|신약|의약품/], ["화장품", /화장품|뷰티|미용/],
  ["식품", /식품|푸드|외식|먹거리/], ["농업", /농업|농산|원예|스마트팜/],
  ["관광", /관광|여행/], ["콘텐츠", /콘텐츠|게임|웹툰|애니메이션|캐릭터|방송|영화|음악/],
  ["패션", /패션|의류|섬유/], ["금융", /금융|핀테크|보험/],
  ["물류", /물류|해운|항만|운송/], ["유통", /유통|리테일|커머스|쇼핑몰/],
  ["에너지환경세라믹", /에너지환경세라믹/], ["신재생에너지", /신재생에너지|태양광|풍력/],
  ["환경", /환경|재활용|폐자원|탄소중립/], ["수소", /수소/],
  ["기계", /기계|금속가공/], ["전자", /전자|전기전자/], ["제조업", /제조|생산|공장|공정/],
  ["IT", /\bIT\b|정보통신|소프트웨어|온라인|디지털|클라우드|SaaS|플랫폼/iu],
  ["소비재", /소비재|생활용품|완제품|브랜드|제품\s*(?:판매|판로|수출)/],
  ["서비스", /서비스업|서비스\s*(?:산업|기업)|사회서비스|교육서비스/],
]);

const redundantIndustryGroups = Object.freeze([
  ["AI", "인공지능"], ["이차전지", "2차전지", "배터리"], ["VR", "가상현실"],
  ["바이오", "바이오융합", "융합바이오"], ["자동차", "미래차", "미래모빌리티"],
  ["콘텐츠", "문화콘텐츠"], ["SW", "SW개발"], ["제조", "제조업"],
]);

const provinceAliases = Object.freeze({
  서울: ["서울특별시", "서울"], 부산: ["부산광역시", "부산"], 대구: ["대구광역시", "대구"],
  인천: ["인천광역시", "인천"], 광주: ["광주광역시", "광주"], 대전: ["대전광역시", "대전"],
  울산: ["울산광역시", "울산"], 세종: ["세종특별자치시", "세종"], 경기: ["경기도", "경기"],
  강원: ["강원특별자치도", "강원도", "강원"], 충북: ["충청북도", "충북"], 충남: ["충청남도", "충남"],
  전북: ["전북특별자치도", "전라북도", "전북"], 전남: ["전라남도", "전남"],
  경북: ["경상북도", "경북"], 경남: ["경상남도", "경남"], 제주: ["제주특별자치도", "제주도", "제주"],
});

const localitiesByProvince = Object.freeze({
  서울: "종로구 중구 용산구 성동구 광진구 동대문구 중랑구 성북구 강북구 도봉구 노원구 은평구 서대문구 마포구 양천구 강서구 구로구 금천구 영등포구 동작구 관악구 서초구 강남구 송파구 강동구".split(" "),
  부산: "중구 서구 동구 영도구 부산진구 동래구 남구 북구 해운대구 사하구 금정구 강서구 연제구 수영구 사상구 기장군".split(" "),
  대구: "중구 동구 서구 남구 북구 수성구 달서구 달성군 군위군".split(" "),
  인천: "미추홀구 연수구 남동구 부평구 계양구 서구 강화군 옹진군 검단구 제물포구 영종구".split(" "),
  광주: "동구 서구 남구 북구 광산구".split(" "), 대전: "동구 중구 서구 유성구 대덕구".split(" "),
  울산: "중구 남구 동구 북구 울주군".split(" "),
  세종: [],
  경기: "수원시 고양시 용인시 성남시 부천시 화성시 안산시 남양주시 안양시 평택시 시흥시 파주시 의정부시 김포시 광주시 광명시 군포시 하남시 오산시 양주시 이천시 구리시 안성시 포천시 의왕시 양평군 여주시 동두천시 가평군 과천시 연천군".split(" "),
  강원: "춘천시 원주시 강릉시 동해시 태백시 속초시 삼척시 홍천군 횡성군 영월군 평창군 정선군 철원군 화천군 양구군 인제군 고성군 양양군".split(" "),
  충북: "청주시 충주시 제천시 보은군 옥천군 영동군 증평군 진천군 괴산군 음성군 단양군".split(" "),
  충남: "천안시 공주시 보령시 아산시 서산시 논산시 계룡시 당진시 금산군 부여군 서천군 청양군 홍성군 예산군 태안군".split(" "),
  전북: "전주시 군산시 익산시 정읍시 남원시 김제시 완주군 진안군 무주군 장수군 임실군 순창군 고창군 부안군".split(" "),
  전남: "목포시 여수시 순천시 나주시 광양시 담양군 곡성군 구례군 고흥군 보성군 화순군 장흥군 강진군 해남군 영암군 무안군 함평군 영광군 장성군 완도군 진도군 신안군".split(" "),
  경북: "포항시 경주시 김천시 안동시 구미시 영주시 영천시 상주시 문경시 경산시 의성군 청송군 영양군 영덕군 청도군 고령군 성주군 칠곡군 예천군 봉화군 울진군 울릉군".split(" "),
  경남: "창원시 진주시 통영시 사천시 김해시 밀양시 거제시 양산시 의령군 함안군 창녕군 고성군 남해군 하동군 산청군 함양군 거창군 합천군".split(" "),
  제주: ["제주시", "서귀포시"],
});

const localityBase = (name) => {
  const base = name.replace(/(?:특례시|특별자치시|시|군|구)$/u, "");
  return base.length === 1 ? name : base;
};
const localityBaseCounts = new Map();
for (const name of Object.values(localitiesByProvince).flat()) {
  const base = localityBase(name);
  localityBaseCounts.set(base, (localityBaseCounts.get(base) ?? 0) + 1);
}
for (const province of Object.keys(provinceAliases)) localityBaseCounts.set(province, (localityBaseCounts.get(province) ?? 0) + 1);

const localityTag = (province, name) => {
  const base = localityBase(name);
  if (base === province) return province;
  return (localityBaseCounts.get(base) ?? 0) > 1 ? `${province} ${base}` : base;
};

const provinceLabels = Object.freeze({
  서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시",
  광주: "광주광역시", 대전: "대전광역시", 울산: "울산광역시", 세종: "세종특별자치시",
  경기: "경기도", 강원: "강원특별자치도", 충북: "충청북도", 충남: "충청남도",
  전북: "전북특별자치도", 전남: "전라남도", 경북: "경상북도", 경남: "경상남도",
  제주: "제주특별자치도",
});

export const ADMINISTRATIVE_REGION_GROUPS = Object.freeze(
  Object.entries(localitiesByProvince).map(([key, localities]) => Object.freeze({
    key,
    label: provinceLabels[key],
    options: Object.freeze([...new Set([key, ...localities.map((name) => localityTag(key, name))])]),
  })),
);

export function groupAdministrativeRegionOptions(options = []) {
  const available = new Set(options);
  const groupedValues = new Set(["전국"]);
  const groups = ADMINISTRATIVE_REGION_GROUPS.map((group) => {
    group.options.forEach((option) => groupedValues.add(option));
    return { ...group, options: group.options.filter((option) => available.has(option)) };
  }).filter((group) => group.options.length);
  return {
    nationwide: available.has("전국"),
    groups,
    ungrouped: options.filter((option) => !groupedValues.has(option)),
  };
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasDelimited = (text, value) => new RegExp(`(^|[^가-힣])${escapeRegExp(value)}(?=$|[^가-힣])`, "u").test(text);
const restrictionMentions = (text, value) => new RegExp(`${escapeRegExp(value)}\\s*(?:소재|지역|관내|내\\s*(?:본사|사업장|기업)|에\\s*(?:본사|사업장)|로\\s*이전)`, "u").test(text);

function industrySources(record, source) {
  return {
    title: String(record.title ?? source.title ?? ""),
    field: String(source.field ?? source.category ?? ""),
    target: String(record.target ?? source.target_raw ?? ""),
    details: String(record.details ?? source.support_raw ?? ""),
    body: "",
  };
}

function redundantIndustry(left, right) {
  if (left === right) return true;
  return redundantIndustryGroups.some((group) => group.includes(left) && group.includes(right));
}

function inferDetailedIndustries(record, source = {}, options = DETAILED_INDUSTRY_OPTIONS) {
  const allowed = new Set(options.filter((tag) => !nonIndustryTags.has(tag)));
  const sources = industrySources(record, source);
  const combined = Object.values(sources).join(" ");
  const scores = new Map();
  const add = (tag, score) => {
    if (allowed.has(tag)) scores.set(tag, Math.max(scores.get(tag) ?? 0, score));
  };

  for (const tag of options) {
    if (!allowed.has(tag)) continue;
    const weakMatcher = weakIndustryMatchers.get(tag);
    if (weakMatcher && !weakMatcher.test(combined)) continue;
    let score = 0;
    if (sources.title.includes(tag)) score += 80 + tag.length;
    if (sources.field.includes(tag)) score += 70 + tag.length;
    if (sources.target.includes(tag)) score += 35 + tag.length;
    if (sources.body.includes(tag)) score += 10 + tag.length;
    if (Array.isArray(record.industries) && record.industries.includes(tag)) score += 110;
    if (score) add(tag, score);
  }
  const classificationText = `${sources.title} ${sources.field} ${sources.target}`;
  for (const [tag, pattern] of semanticIndustrySignals) if (pattern.test(classificationText)) add(tag, 75);

  const selected = [];
  for (const [tag] of [...scores].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0], "ko"))) {
    if (selected.some((chosen) => redundantIndustry(chosen, tag))) continue;
    selected.push(tag);
    if (selected.length === 2) return selected;
  }

  const broadEligibility = /사회적경제|사회연대경제|소상공인|창업기업|중소기업|중견기업/u.test(sources.target);
  const fallbacks = broadEligibility
    ? ["서비스", "제조업", "소비재", "산업재"]
    : /제조|생산|공장|공정|시제품|부품|장비/u.test(combined)
    ? ["제조업", "산업재", "서비스", "소비재"]
    : /온라인|소프트웨어|정보통신|플랫폼|솔루션|데이터/u.test(combined)
      ? ["IT", "서비스", "제조업", "소비재"]
      : /제품|브랜드|판로|판매|전시|유통/u.test(combined)
        ? ["소비재", "유통", "제조업", "서비스"]
        : ["서비스", "제조업", "소비재", "산업재"];
  for (const tag of fallbacks) {
    if (!allowed.has(tag) || selected.some((chosen) => redundantIndustry(chosen, tag))) continue;
    selected.push(tag);
    if (selected.length === 2) break;
  }
  return selected;
}

const TOP_INDUSTRY_GROUPS = Object.freeze([
  ["AI·디지털", /\bAI\b|인공지능|IT|ICT|SW|소프트웨어|SaaS|데이터|디지털|플랫폼|클라우드|5G|IoT|블록체인|XR|AR|VR|메타버스|보안|양자|스마트시티|에듀테크/iu],
  ["바이오·헬스케어", /바이오|헬스|의료|제약|의약|병원|치료|웰니스|고령|천연물/iu],
  ["제조·소부장", /제조|산업재|기계|금속|소재|장비|반도체|전자|부품|세라믹|나노|공장|화학|인쇄|3D\s*프린터|스마트공장/iu],
  ["모빌리티·로봇", /자동차|미래차|모빌리티|로봇|드론|항공|조선|자율주행|전기차|해운|항만/iu],
  ["에너지·환경", /에너지|환경|기후|탄소|수소|태양광|원전|배터리|이차전지|재생|리사이클|업사이클|친환경/iu],
  ["콘텐츠·관광", /콘텐츠|게임|문화|관광|여행|예술|웹툰|출판|스포츠|엔터|공예/iu],
  ["유통·소비재", /유통|리테일|소비재|식품|농식품|뷰티|화장품|미용|패션|생활|커피|F&B|주얼리|반려동물/iu],
  ["농림·수산·해양", /농업|농촌|농산|축산|스마트팜|애그테크|임업|산림|수산|어업|해양/iu],
  ["금융·비즈니스서비스", /금융|핀테크|서비스|지식서비스|컨설팅|마케팅|디자인|무역|수출/iu],
  ["건설·공간", /건설|건축|공간|도시|부동산|인프라/iu],
  ["국방·우주", /국방|방위|우주|항공우주/iu],
  ["교육·사회서비스", /교육|사회복지|돌봄|유아|라이프케어/iu],
]);

export function inferIndustries(record, source = {}) {
  const sources = industrySources(record, source);
  const detailed = inferDetailedIndustries(record, source);
  const text = `${sources.title} ${sources.field} ${sources.target} ${sources.details} ${(record.industries ?? []).join(" ")} ${detailed.join(" ")}`;
  const selected = TOP_INDUSTRY_GROUPS
    .map(([tag, pattern]) => ({ tag, score: [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))].length }))
    .filter(({ score }) => score)
    .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag, "ko"))
    .slice(0, 1)
    .map(({ tag }) => tag);
  return selected.length ? selected : ["금융·비즈니스서비스"];
}

export function inferRegions(record, source = {}) {
  const title = String(record.title ?? source.title ?? "");
  const target = [record.target, source.target_raw].filter(Boolean).join(" ");
  const bracketText = [...title.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]).join(" ");
  const found = new Set();

  for (const [province, aliases] of Object.entries(provinceAliases)) {
    const fullAliases = aliases.filter((alias) => alias !== province);
    if (bracketText.includes(province) || fullAliases.some((alias) => title.includes(alias) || target.includes(alias)) || restrictionMentions(target, province)) {
      found.add(province);
    }
  }

  for (const [province, names] of Object.entries(localitiesByProvince)) {
    for (const name of names) {
      const base = localityBase(name);
      if ((localityBaseCounts.get(base) ?? 0) > 1 && !found.has(province)) continue;
      if (hasDelimited(title, name) || hasDelimited(target, name) || hasDelimited(title, base) || restrictionMentions(target, base)) {
        found.add(province);
        found.add(localityTag(province, name));
      }
    }
  }

  if (found.size) return [...found];
  const existing = (Array.isArray(record.regions) ? record.regions : []).filter((region) => region && region !== "전국");
  return existing.length ? [...new Set(existing)] : ["전국"];
}

export function regionOptionsFor(records) {
  return [...new Set(records.flatMap(({ record, source }) => inferRegions(record, source)))].filter((region) => region !== "전국");
}
