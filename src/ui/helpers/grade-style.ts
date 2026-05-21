/**
 * Grade visual style — cards (Rarity) and skills (SkillGrade) share
 * the same 3-tier vocabulary, so the same palette + bracket pair is
 * used everywhere a graded item appears.
 *
 * Color picks per user spec:
 *   Common    → 밝은 회색 (#bcbcbc)
 *   Rare      → 하츠네 미쿠 머리색 청록 (#39c5bb, 파랑에 약간 더 가까운)
 *   Legendary → 빨강에 가까운 핑크-레드 (#ff5577)
 *
 * Brackets: `《 》` (사각 가운데 따옴표). 회색·청록·붉은색 다 잘 보임.
 * "등급 표시가 의미 있는 선택지" 라는 시각 신호로 일관 사용.
 */

export interface GradeStyle {
  readonly color: string;
  readonly bracketOpen: string;
  readonly bracketClose: string;
}

const STYLE_COMMON: GradeStyle    = { color: '#bcbcbc', bracketOpen: '《', bracketClose: '》' };
const STYLE_RARE: GradeStyle      = { color: '#39c5bb', bracketOpen: '《', bracketClose: '》' };
const STYLE_LEGENDARY: GradeStyle = { color: '#ff5577', bracketOpen: '《', bracketClose: '》' };
const STYLE_FALLBACK: GradeStyle  = { color: 'white',   bracketOpen: '《', bracketClose: '》' };

export function gradeStyle(grade: string | undefined): GradeStyle {
  switch (grade) {
    case 'common':    return STYLE_COMMON;
    case 'rare':      return STYLE_RARE;
    case 'legendary': return STYLE_LEGENDARY;
    default:          return STYLE_FALLBACK;
  }
}

/** Wrap a name in the grade brackets — used in FocusList labels. */
export function wrapWithGradeBrackets(name: string, grade: string | undefined): string {
  const s = gradeStyle(grade);
  return `${s.bracketOpen}${name}${s.bracketClose}`;
}

/** Quick color lookup for headers / strip rows that don't need a bracket. */
export function gradeColor(grade: string | undefined): string {
  return gradeStyle(grade).color;
}
