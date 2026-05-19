# 02. 카드 & 모디파이어 시스템

게임의 심장. 이 문서가 가장 중요하다.

## 핵심 분리: Definition vs Instance

```
CardDefinition          → 불변 데이터, 한 카드의 "원형"
CardInstance            → 게임 내 실제 카드 한 장. 강화가 누적되는 단위.
```

같은 "단검투척" 카드라도 인스턴스 A는 `[+5 피해]` 만 붙어 있고, 인스턴스 B는 `[+5 피해, 출혈 부여, 비용 -1]` 처럼 다를 수 있다. 인벤토리에 보관된 시점의 모디파이어가 그대로 유지된다.

## 카드 1장의 생애주기

```
1. 획득        → CardInstance 생성 (defId 지정, modifiers=[])
                  소스: 시작 덱 / 이벤트 보상 / 전투 보상 / 차원 창고에서 꺼냄

2. 강화 시도   → ModifierResolver 가 후보 모디파이어 풀 계산
                  → 가중치 샘플링으로 N개 제시
                  → 유저가 1개 선택 → CardInstance.modifiers.push(...)

3. 사용 (전투) → CardEffectResolver 가 baseEffects → modifiers 순차 적용
                  → 최종 Effect[] 산출 → EffectExecutor.run(...)

4. 보관/폐기   → 휴식처에서 인벤토리(보관) 또는 골드 환산(폐기)
                  → 캐릭터 사망과 무관하게 글로벌 인벤토리에 살아남음
```

## 모디파이어 합성 알고리즘

### 입력
```
CardDefinition.baseEffects: ReadonlyArray<Effect>  // 원본 효과
CardInstance.modifiers:     ModifierInstance[]      // 부착된 모디파이어 (순서 중요)
```

### 알고리즘
```typescript
function resolveCardEffects(
  def: CardDefinition,
  instance: CardInstance,
  registry: ModifierRegistry,
  ctx: ResolutionContext,
): ResolvedCard {
  let effects: Effect[] = structuredClone(def.baseEffects) as Effect[];
  let cost = def.cost;
  let keywords = new Set(def.keywords);

  for (const modInst of instance.modifiers) {
    const mod = registry.get(modInst.id);
    for (const tx of mod.transforms) {
      switch (tx.op) {
        case 'modifyEffect':
          effects = applyPatch(effects, tx.match, tx.set);
          break;
        case 'appendEffect':
          effects.push(tx.effect);
          break;
        case 'prependEffect':
          effects.unshift(tx.effect);
          break;
        case 'replaceEffect':
          effects = replaceMatching(effects, tx.match, tx.with);
          break;
        case 'removeEffect':
          effects = effects.filter(e => !matches(e, tx.match));
          break;
        case 'wrapEffect':
          effects = wrapMatching(effects, tx.match, tx.before, tx.after);
          break;
        case 'modifyCost':
          cost = adjustCost(cost, tx.delta);
          break;
        case 'addKeyword':
          keywords.add(tx.keyword);
          break;
        case 'removeKeyword':
          keywords.delete(tx.keyword);
          break;
      }
    }
  }

  return { effects, cost, keywords: [...keywords], description: renderDescription(def, instance, ctx) };
}
```

### Transform 시맨틱 정밀 정의

#### `modifyEffect` — 매치된 효과의 필드를 패치
- `match`: 어떤 효과를 잡을지. (`kind`, `target`, `tags`, `index`)
- `set`: 어떤 필드를 어떻게 바꿀지.
- 수치 patch: `{ amount: 5 }` 는 절대값, `{ amount: { delta: 5 } }` 는 +5, `{ amount: { mul: 2 } }` 는 ×2.
- 순서: 절대값 set이 가장 우선, delta·mul은 후속 적용 시 누적.

예시:
```yaml
# "예리함" — 모든 damage 효과의 amount +5
- op: modifyEffect
  match: { kind: damage }
  set:   { amount: { delta: 5 } }

# "확산" — 단일 적 타겟 → 모든 적
- op: modifyEffect
  match: { target: enemy }
  set:   { target: allEnemies }
```

#### `appendEffect` / `prependEffect` — 끝/앞에 효과 추가
예시:
```yaml
# "출혈 부여" — 카드 사용 시 데미지 + 출혈 5
- op: appendEffect
  effect: { kind: applyStatus, status: bleed, stacks: 5, target: enemy }

# "선공 방어" — 카드 효과 전에 방어도 5
- op: prependEffect
  effect: { kind: gainBlock, amount: 5 }
```

#### `replaceEffect` — 매치된 효과를 통째로 교체
드물게 쓰임. 효과의 종류 자체가 바뀔 때.

#### `removeEffect` — 매치된 효과 삭제
"부작용 없애기" 모디파이어 등.

#### `wrapEffect` — 매치된 효과 앞뒤로 끼워넣기
예: "데미지 전 약화 부여 + 데미지 후 방어도 회수"
```yaml
- op: wrapEffect
  match: { kind: damage }
  before: { kind: applyStatus, status: weak, stacks: 1, target: enemy }
  after:  { kind: gainBlock,   amount: 3 }
```

#### `modifyCost` — 카드 비용 조정
delta 적용. 결과는 0 이상으로 clamp (또는 "unplayable" 비용은 변형 불가).

#### `addKeyword` / `removeKeyword` — 키워드 추가/제거
"이 카드는 사용 시 소멸한다" → `addKeyword: exhaust`.

### 매칭 규칙 (`EffectMatcher`)

```typescript
function matches(effect: Effect, m: EffectMatcher): boolean {
  if (m.kind && effect.kind !== m.kind) return false;
  if (m.target && (effect as any).target !== m.target) return false;
  if (m.tags && !m.tags.every(t => (effect as any).tags?.includes(t))) return false;
  return true;
}
```

`index` 필드는 매치 후 적용 단계에서 사용:
- `'all'` (기본): 모든 매치 대상에 적용
- `'first'` / `'last'`: 첫/끝 매치만
- `number`: N번째 매치만 (0-base)

### Patch 적용 순서 (수치 충돌 시)

여러 모디파이어가 같은 필드를 건드릴 때:

1. `set.value` (절대값) — 가장 마지막에 selected가 우선
2. `set.delta` (가산) — 누적 합산
3. `set.mul` (승산) — 누적 곱셈

최종: `final = (anyAbsoluteSet ?? base + sumOfDeltas) * productOfMuls`

이걸 보장하려면 transform 순회를 두 패스로 한다:
- 패스 1: 절대 set 수집
- 패스 2: delta 합산
- 패스 3: mul 누적
- 마지막: 종합 계산

(또는 한 패스로 처리하되 각 필드에 `{ abs?, delta?, mul? }` 어큐뮬레이터를 유지)

## 모디파이어 풀 시스템

### 풀이 카드에 어떻게 묶이나

```
CardDefinition.modifierPoolRefs: [poolId1, poolId2, ...]
                                        ↓
                       강화 후보 = ∪ ModifierPool[i].entries
                                        ↓
                       이미 부착된 modifier 제외 (중복 금지)
                                        ↓
                       conflictsWith 위반 제외
                                        ↓
                       requires 미충족 제외
                                        ↓
                       PoolCondition 미충족 제외
                                        ↓
                       conditional override (이벤트가 add/remove 풀)
                                        ↓
                       가중치 정규화 + 샘플링
                                        ↓
                       N개 제시 → 유저 선택
```

### 가중치 샘플링

표준 가중치 룰렛휠. 한 번에 N개 제시할 때 **중복 없이 N개 뽑기** (replacement 없음):

```typescript
function sampleWithoutReplacement(
  entries: Array<{ id: ModifierId; weight: number }>,
  n: number,
  rng: IRandom,
): ModifierId[] {
  const picked: ModifierId[] = [];
  const pool = [...entries];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const total = pool.reduce((s, e) => s + e.weight, 0);
    if (total <= 0) break;
    let r = rng.float() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    picked.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return picked;
}
```

후보가 부족하면 N보다 적게 반환 (UI는 "선택 가능한 강화가 부족합니다" 처리).

### 이벤트 컨텍스트 override

`CardUpgradeStep.modifierPoolOverride` 가 있으면 카드 자체의 풀에 더해진다:

```typescript
function resolveUpgradePools(
  cardDef: CardDefinition,
  override?: { add?: ModifierPoolId[]; remove?: ModifierPoolId[] },
): ModifierPoolId[] {
  let pools = new Set(cardDef.modifierPoolRefs);
  for (const r of override?.remove ?? []) pools.delete(r);
  for (const a of override?.add ?? []) pools.add(a);
  return [...pools];
}
```

이로써 "고대의 풀 (이벤트에서만 등장)" 같은 디자인이 가능.

## 설명 텍스트 렌더링

카드의 설명문은 베이스 + 모디파이어 부착 결과를 실시간 합성해야 한다.

### 접근법 A — 효과 기반 자동 생성 (선호)
`ResolvedCard.effects` 를 사람 읽기 좋은 문장으로 렌더링.

```typescript
function renderEffectLine(effect: Effect): string {
  switch (effect.kind) {
    case 'damage':       return `${targetText(effect.target)}에 ${effect.amount}의 피해`;
    case 'gainBlock':    return `방어도 ${effect.amount} 획득`;
    case 'applyStatus':  return `${targetText(effect.target)}에 ${statusName(effect.status)} ${effect.stacks} 부여`;
    case 'draw':         return `카드 ${effect.count}장 뽑기`;
    // ...
  }
}

function renderCardDescription(resolved: ResolvedCard): string {
  return resolved.effects.map(renderEffectLine).join('. ') + '.';
}
```

장점: 모디파이어 부착이 자동으로 설명에 반영. 디자이너가 텍스트 일관성 신경 X.
단점: 자동 생성 문체가 어색할 수 있음.

### 접근법 B — 베이스 템플릿 + 모디파이어 어펜드
`CardDefinition.baseDescription` 에 변수 치환 (`{damage}`), `ModifierInstance` 마다 한 줄 추가 (`Modifier.descriptionTemplate`).

장점: 자연스러운 문체.
단점: 모디파이어가 base 수치를 바꿔도 base 설명문 갱신이 어려움.

### 결정: 하이브리드
- **베이스 설명문**: 변수 치환만 (`{damage}` → 합성된 최종 amount)
- **모디파이어 부착 시 추가 줄**: `Modifier.descriptionTemplate` 을 그대로 append
- 변수 치환은 `ResolvedCard.effects` 의 값에서 추출

```
단검투척 (1 에너지)
가장 가까운 적에게 10의 피해를 줍니다.
+ 피해량이 5 증가합니다.
+ 명중한 적이 출혈(5)를 얻습니다.
```

(첫 줄은 base 설명, "+" 줄은 모디파이어들)

`{damage}` 같은 변수는 우측 패널에서 합성된 후의 최종 수치로 표시:
```
단검투척 (1 에너지)
가장 가까운 적에게 15의 피해를 줍니다.    ← 자동으로 +5 반영
명중한 적이 출혈(5)를 얻습니다.            ← 모디파이어가 만든 효과 줄
```

설명 렌더링 정밀 스펙은 v1 초기 구현 후 디자이너 피드백 받아 다듬는다.

## 시각화 (UI 측면)

### 카드 목록 (좌측 패널)
```
┌─ 손패 ──────────────┐
│ > 단검투척 (1)+     │  ← + 아이콘은 강화된 카드
│   방패 올리기 (1)   │
│   강타 (2)++        │  ← ++는 강화 2개 이상
│   회복의 빛 (1)     │
└─────────────────────┘
```

### 카드 상세 (우측 패널)
```
┌─ 단검투척 ────────────────┐
│ 비용: 1   타입: 공격      │
│ 타겟: 단일 적             │
│ ─────────────────────────  │
│ 적에게 15의 피해를 줍니다. │
│ 명중한 적이 출혈(5)를 얻습  │
│ 니다.                     │
│ ─────────────────────────  │
│ 강화 (2):                 │
│  • 예리함 (+5 피해)       │
│  • 독칠 (출혈 5 부여)     │
└───────────────────────────┘
```

## 카드 인스턴스 ID 관리

- 생성 시 `crypto.randomUUID()` (Node 20+ 내장).
- 절대 재발급 X. 차원 창고에 보관되었다 다시 나와도 동일 ID 유지.
- 세이브 파일 간 충돌 가능성: 사실상 0 (UUID v4의 가정).
- 디버그: 로그에는 `instanceId` 의 앞 8자리만 출력 (가독성).

## 카드 사본 다루기

같은 `defId` 의 카드를 여러 장 가질 수 있다. 각각 독립된 `instanceId` 와 모디파이어 목록.

```
인벤토리:
  - dagger_throw  (instId: a1b2..., mods: [+5피해])
  - dagger_throw  (instId: c3d4..., mods: [확산, 출혈])
  - dagger_throw  (instId: e5f6..., mods: [])
```

→ "단검투척이 3장 있다" 는 단순 카운트지만, 강화는 인스턴스마다 다름.
UI에서 인벤토리 목록은 `defId` 별 그루핑 + 강화 정도 표시 권장:
```
단검투척 × 3
  ├ a1b2 (+1 강화)
  ├ c3d4 (+2 강화)
  └ e5f6 (강화 없음)
```

## 코드형 모디파이어 (drop-in handler)

데이터 DSL로 표현 불가능한 모디파이어는 핸들러 함수로:

```typescript
// src/engine/modifiers/handlers/copy_random_in_deck.ts
export const handler: CustomModifierHandler = {
  id: 'mod_copy_random_in_deck',
  // 카드 사용 시 추가로 일어날 일
  onCardPlayed(ctx, cardInstance) {
    const candidates = ctx.run.player.deckIds.filter(id => id !== cardInstance.instanceId);
    if (candidates.length === 0) return;
    const pickedId = ctx.rng.pick(candidates);
    const copy = ctx.cards.cloneInstance(pickedId);
    ctx.combat.addCardToPile(copy, 'discard');
  }
};
```

핸들러는 `ModifierRegistry.registerHandler(...)` 로 부팅 시 등록. Modifier 데이터의 `transforms` 가 빈 배열이고 `customHandlerId` 가 있으면 핸들러 모드로 동작.

```typescript
interface Modifier {
  // ... 기존 필드
  readonly customHandlerId?: string;       // 코드 모드일 때
}
```

## 검증 규칙 (build-data.ts 가 강제)

다음은 빌드 시점에 깨지면 빌드 실패:

1. 모든 `CardDefinition.modifierPoolRefs` 의 ID는 실제 풀에 존재
2. 모든 `ModifierPoolEntry.modifierId` 는 실제 모디파이어에 존재
3. 모든 `Modifier.conflictsWith`, `requires` 의 ID 도 마찬가지
4. `Modifier.customHandlerId` 가 있으면 코드 측에 해당 핸들러가 등록되어야 함 (런타임 검증)
5. `CardDefinition.maxModifiers` 가 있으면 자연수
6. ID는 영문 소문자 + 숫자 + 언더스코어, snake_case 강제

## 미정 (TBD)

- **카드 강등/모디파이어 제거 메커니즘**: 디스폼/리롤 이벤트 같은 게 필요한가? v1은 "강화만 누적" 으로 시작, 추후 `removeModifier` 액션 추가 검토.
- **카드 분해**: 카드를 골드로 환산하는 룰. 단순 (희귀도 + 강화 수)? 데이터 테이블화?
- **카드 인스턴스 수명 통계**: "이 카드로 X명 죽임" 같은 메타. 추후.
