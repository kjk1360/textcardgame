# 03. 전투 시스템

## 전투의 책임 범위

`CombatEngine` 의 책임:
- 덱/손패/discard/exhaust pile 관리
- 드로우 + 셔플
- 카드 사용 파이프라인 (비용 → 타겟 → 모디파이어 해석 → 효과 실행)
- 상태 효과(Status) 처리
- 적 의도(Intent) 결정 및 실행
- 턴 진행 (player → enemy → player ...)
- 승리/패배 판정

**책임 아닌 것:**
- 맵, 이벤트, 세이브, 인벤토리, 골드 환산 — 모두 상위 layer.
- UI 렌더링 — Engine은 snapshot만 노출.

## 전투 상태

```typescript
interface CombatState {
  combatId: string;
  enemies: EnemyInstance[];
  turn: number;                          // 1부터
  phase: CombatPhase;
  awaiting?: AwaitInput;
  rngSeed: string;                       // 결정적
  log: CombatLogEntry[];                 // UI 표시 + 디버그
}

type CombatPhase =
  | 'starting'         // 시작 이펙트 처리 중
  | 'playerTurn'       // 입력 대기
  | 'resolving'        // 카드/효과 처리 중 (애니메이션·로그)
  | 'awaitingInput'    // 타겟 선택 등 추가 입력 대기
  | 'enemyTurn'        // 적 행동 중
  | 'turnEnd'          // 턴 종료 처리 (상태 효과 decay 등)
  | 'won'
  | 'lost';
```

## 턴 흐름

### 전투 시작
```
1. combatId 발급, RNG 시드 설정
2. 적 배치 (EnemyGroup → EnemyInstance[])
3. 적 초기 상태/난이도 버프 적용
4. 적 첫 의도 결정
5. 플레이어 deckIds → drawPile 으로 셔플
6. innate 키워드 카드 우선 드로우
7. 일반 드로우 (drawAmountPerTurn 만큼)
8. onCombatStart 훅 발동 (스킬/패시브/유물)
9. phase → 'playerTurn'
```

### 플레이어 턴

```
phase: 'playerTurn'
  ↓ 유저 입력 대기
  ├─ COMBAT_PLAY_CARD: 카드 사용 흐름 진입
  └─ COMBAT_END_TURN: 턴 종료
```

### 카드 사용 흐름

```typescript
function playCard(cardInstanceId: CardInstanceId): void {
  // 1. 카드가 손패에 있는지
  const card = state.player.hand.find(c => c.instanceId === cardInstanceId);
  if (!card) throw 'card not in hand';

  // 2. 비용 체크
  const resolved = resolveCardEffects(getDef(card.defId), card, registry, ctx);
  if (!canAfford(resolved.cost, state.player)) throw 'cannot afford';

  // 3. 타겟 필요한지 확인
  const def = getDef(card.defId);
  if (def.target.kind === 'enemy') {
    // 타겟 선택 대기
    state.phase = 'awaitingInput';
    state.awaiting = {
      kind: 'pickEnemy',
      forEffectIndex: -1,
      cardInstanceId,
    };
    return; // COMBAT_TARGET 액션으로 재개
  }

  // 4. 즉시 실행
  executeCardPlay(card, resolved, /*target=*/undefined);
}

function onTarget(enemyInstanceId: string): void {
  const { cardInstanceId } = state.awaiting!;
  const card = state.player.hand.find(c => c.instanceId === cardInstanceId);
  const resolved = resolveCardEffects(getDef(card.defId), card, registry, ctx);
  executeCardPlay(card, resolved, enemyInstanceId);
}

function executeCardPlay(card: CardInstance, resolved: ResolvedCard, target?: string): void {
  // a. 비용 차감
  spendEnergy(resolved.cost);

  // b. 손패에서 제거 (실행 중에는 "in-play" 임시 영역)
  removeFromHand(card.instanceId);

  // c. 효과 순차 실행
  for (let i = 0; i < resolved.effects.length; i++) {
    executeEffect(resolved.effects[i], { sourceCard: card, target, effectIndex: i });
    // 효과 도중 추가 입력 필요하면 phase → 'awaitingInput', 후속 처리는 액션 재진입
  }

  // d. 키워드 처리: exhaust면 exhaust pile로, 아니면 discard로
  if (resolved.keywords.includes('exhaust')) {
    addToExhaust(card);
    emit('onCardExhausted', card);
  } else {
    addToDiscard(card);
  }

  // e. onCardPlayed 훅
  emit('onCardPlayed', card);
}
```

### 효과 실행

```typescript
function executeEffect(effect: Effect, ctx: EffectContext): void {
  const handler = effectExecutor.get(effect.kind);
  handler(effect, ctx);
  // 핸들러가 상태 변경, 데미지 계산, 상태 효과 hook 트리거, 로그 추가 등 수행
}
```

### 드로우 알고리즘

```typescript
function draw(n: number): void {
  for (let i = 0; i < n; i++) {
    if (state.player.drawPile.length === 0) {
      if (state.player.discardPile.length === 0) break; // 둘 다 비면 종료
      // discard → draw 로 옮긴 후 셔플
      state.player.drawPile = shuffle(state.player.discardPile, rng);
      state.player.discardPile = [];
      emit('onDeckReshuffled');
    }
    const card = state.player.drawPile.pop()!;
    state.player.hand.push(card);
    emit('onCardDrawn', card);
  }
}
```

손패 한도 (기본 10) 초과 시: 새로 뽑은 카드는 즉시 discard로 보냄 (또는 슬더스처럼 단순 discard).

### 턴 종료

```typescript
function endPlayerTurn(): void {
  // 1. 손패의 비-보존 카드 discard
  for (const card of state.player.hand) {
    if (!resolveCardEffects(getDef(card.defId), card, registry, ctx).keywords.includes('retain')) {
      addToDiscard(card);
    }
  }
  state.player.hand = state.player.hand.filter(/* retain만 */);

  // 2. 플레이어 상태 효과 EndOfTurn 처리
  tickStatusesEndOfTurn(state.player.statuses);

  // 3. 플레이어 방어도 (block) 0 으로 리셋 (allAtEndOfTurn 룰)
  state.player.block = 0;

  emit('onTurnEnd', { actor: 'player' });

  // 4. 적 턴
  state.phase = 'enemyTurn';
  runEnemyTurn();
}

function runEnemyTurn(): void {
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const intent = enemy.nextIntent;
    for (const eff of intent.effects) {
      executeEffect(eff, { source: enemy });
    }
    tickStatusesEndOfTurn(enemy.statuses);
    enemy.block = 0; // 적도 동일 룰
    // 다음 의도 결정
    enemy.nextIntent = decideNextIntent(enemy);
  }

  state.phase = 'playerTurn';
  state.turn++;
  emit('onTurnStart', { actor: 'player' });
  startOfPlayerTurn();
}

function startOfPlayerTurn(): void {
  // 1. 에너지 재충전
  state.player.energy = state.player.maxEnergy;
  // 2. 플레이어 상태 효과 StartOfTurn 처리
  tickStatusesStartOfTurn(state.player.statuses);
  // 3. 카드 드로우
  draw(state.player.drawAmountPerTurn);
}
```

## 상태 효과 시스템

### 등록과 적용

```typescript
function applyStatus(target: Targetable, statusId: StatusId, stacks: number): void {
  const def = registry.status.get(statusId);
  const existing = target.statuses.find(s => s.id === statusId);
  if (existing) {
    switch (def.stackingRule) {
      case 'sum':      existing.stacks += stacks; break;
      case 'max':      existing.stacks = Math.max(existing.stacks, stacks); break;
      case 'duration': existing.duration = (existing.duration ?? 0) + stacks; break;
    }
  } else {
    target.statuses.push({ id: statusId, stacks });
  }
  // onApplied 훅 발동
  for (const hook of def.hooks.filter(h => h.on === 'onApplied')) {
    if (!evalCondition(hook.condition, ctx)) continue;
    for (const eff of hook.effects) executeEffect(eff, ctx);
  }
}
```

### 훅 디스패치

상태 효과는 게임 이벤트 발생 시 자기 hook을 검사한다:

```typescript
emit('onTakeDamage', { target, amount });
  ↓
for (const status of target.statuses) {
  const def = registry.status.get(status.id);
  for (const hook of def.hooks.filter(h => h.on === 'onTakeDamage')) {
    if (evalCondition(hook.condition, ctx)) {
      for (const eff of hook.effects) executeEffect(eff, ctx);
    }
  }
}
```

### 데미지 계산 파이프라인

데미지는 단순 `amount` 차감이 아니라 파이프라인을 거친다:

```
incomingDamage (raw)
  ↓
applyOutgoingModifiers(source.statuses)
  - source가 약화면 ×0.75
  - source가 근력 +N이면 +N (공격류만)
  ↓
applyIncomingModifiers(target.statuses)
  - target이 취약이면 ×1.5
  ↓
calculatedDamage
  ↓
applyBlock(target)
  - target.block 만큼 흡수
  - block 음수 안 됨
  ↓
finalHpLoss
  ↓
target.hp -= finalHpLoss
  ↓
emit 'onDamageDealt' / 'onDamageTaken' / 'onEnemyKilled' (hp ≤ 0)
```

훅 발동 순서:
1. `onOutgoingDamage` (source) → 수정 가능
2. `onIncomingDamage` (target) → 수정 가능
3. `onBlocked` (target) → block에 흡수된 양 알림
4. `onHpLoss` (target) → 실제 hp 차감 후
5. `onKilled` (target) → hp ≤ 0 시

각 훅은 인자로 `MutableDamageContext` 를 받아 amount를 조정할 수 있다 (예: 약화 = outgoing ×0.75).

### 기본 상태 효과 목록 (디자인 초안)

> 상태 효과는 데이터. 이건 예시지 코드 상수 아님.

| ID | 이름 | 효과 | 스택링 | 감소 |
|---|---|---|---|---|
| `weak` | 약화 | 공격 데미지 ×0.75 | duration | 턴당 1 |
| `vulnerable` | 취약 | 받는 데미지 ×1.5 | duration | 턴당 1 |
| `strength` | 근력 | 공격 데미지 +N | sum | 없음 |
| `dexterity` | 민첩 | 방어도 획득 시 +N | sum | 없음 |
| `bleed` | 출혈 | 턴 시작 시 N 진짜 데미지 | sum | 트리거당 1 |
| `poison` | 독 | 턴 시작 시 N 진짜 데미지, 1 감소 | sum | 트리거당 1 |
| `regen` | 재생 | 턴 끝 시 N hp 회복 | sum | 트리거당 1 |
| `barrier` | 보호막 | 다음 공격 1회 무효 | max | 트리거당 1 |
| `enrage` | 격노 | 공격받을 때마다 근력 +1 | sum | 없음 |

(슬더스 룰의 직접 베끼기 아닌, 우리 자체 디자인 — 명칭과 룰 자체는 추후 디자이너가 다듬는다.)

## 적 의도 (Intent) 시스템

### 의도 결정 알고리즘

```typescript
function decideNextIntent(enemy: EnemyInstance): Intent {
  const script = registry.enemy.get(enemy.defId).intentScript;
  switch (script.mode) {
    case 'cycle':
      enemy.intentCursor = (enemy.intentCursor + 1) % script.intents.length;
      return script.intents[enemy.intentCursor];

    case 'weighted':
      // 조건 충족 의도들만 가중치 샘플링
      const candidates = script.intents.filter(i =>
        (i.conditions ?? []).every(c => evalCondition(c, makeIntentCtx(enemy)))
      );
      return weightedSample(candidates, rng);

    case 'scripted':
      // 명시적 다음 의도 ID
      const current = script.intents.find(i => i.id === enemy.lastIntentId);
      const nextId = current?.nextIntentId;
      return script.intents.find(i => i.id === nextId) ?? script.intents[0];
  }
}
```

조건부 의도 예: "HP 50% 이하일 때만 광폭화", "3턴마다 회복", "플레이어가 약화 상태일 때 추가 공격".

### 의도 표시 (UI)

```typescript
interface IntentDisplay {
  kind: 'attack' | 'defend' | 'buff' | 'debuff' | 'unknown';
  value?: number;
  hits?: number;
}
```

UI 렌더링:
```
노예상인 HP 46/46 (방어 5)
  의도: 공격 12 × 2
```
또는
```
의도: 방어 + 약화
```

`unknown` 종류는 "?" 표시 (의도 숨김 디자인).

### 의도 값의 동적 수정

적 의도의 데미지 값은 적 자신의 `strength` 상태도 반영해서 표시해야 한다:

```typescript
function renderIntent(enemy: EnemyInstance): IntentDisplay {
  const base = enemy.nextIntent.display;
  if (base.kind === 'attack' && base.value !== undefined) {
    const strBonus = stackOf(enemy.statuses, 'strength');
    return { ...base, value: base.value + strBonus };
  }
  return base;
}
```

플레이어가 약화/근력을 적에게 걸면 의도 표시가 실시간 갱신 — 슬더스와 같음.

## 보상 처리

전투 승리 시:

```typescript
function onCombatWon(): void {
  emit('onCombatEnd', { result: 'won' });
  const reward = computeReward(state.enemies, registry);
  // 임시 RunState에 누적 (런이 끝나야 글로벌로 환원)
  run.player.gold += rng.intBetween(reward.goldRange);
  // 카드 보상은 별도 UI 화면에서 N개 중 1개 선택 (Reward Screen)
  // 스킬 드롭은 확률 굴림 → 떨어지면 Reward Screen에 함께 표시
}
```

`Reward Screen` 은 전투 후 자동 진입. 사용자 선택 후 맵으로 복귀.

## 패배 처리

```typescript
function onCombatLost(): void {
  emit('onCombatEnd', { result: 'lost' });
  // 캐릭터 사망 → 슬롯 데이터 삭제 페이즈로
  metaService.onCharacterDeath(slotIndex);
}
```

`MetaProgressionService.onCharacterDeath` 가:
1. 슬롯 파일 삭제 (안전을 위해 백업 1개 보존?)
2. 런에서 임시로 모은 골드는 글로벌로 환원할지 결정 (디자인: **사망 시 환원 안 함** — 살아 돌아와야만 골드/카드 보존)
3. 인벤토리·글로벌 골드·패시브는 그대로

> **사망 시 골드 정책 결정 필요**: 디자인상 일부 손실 / 절반 / 전손실 — 일단 **전손실** (사망 페널티) 로 시작. 이벤트로 보험 같은 거 만들 여지.

## 결정론 (Determinism)

전투의 모든 무작위성은 `IRandom` 으로:

```typescript
interface IRandom {
  float(): number;          // [0, 1)
  intBetween(min: number, max: number): number;
  pick<T>(arr: ReadonlyArray<T>): T;
  shuffle<T>(arr: ReadonlyArray<T>): T[];
}
```

`combatState.rngSeed` 에서 파생된 RNG 인스턴스 사용 → 같은 시드 + 같은 입력 = 같은 결과. 디버그/재현/리플레이용.

## 게임 상수 (확정 2026-05-19)

데이터로 관리. 코드 단일 진실 공급원: `src/engine/constants.ts` (`DEFAULT_CONSTANTS`). Phase 4에서 `authoring/game_constants.yaml` 로 이동.

| 항목 | 값 | 비고 |
|---|---|---|
| 손패 소프트 한도 | **10** | 일반 드로우는 이 이상 잡지 않음 (디자인 옵션) |
| 손패 하드 한도 | **14** | 어떤 경우에도 초과 불가. 스킬 디자인 시 이 제한을 의식해서 밸런싱 |
| 기본 에너지 | **3** | 턴마다 자동 증가 X. 스킬/카드만 증가 가능 (전투 한정 가능) |
| 턴 드로우 | **4** | 슬더스(5)보다 1 적음. 손패에 retain 카드가 있어도 무조건 4장 추가 드로우 |
| 첫 턴 추가 드로우 | **0** | 스킬로만 변경 |

스킬 훅 예시:
- "매 턴 +1 드로우" → `onTurnStart` hook의 `draw(1)` 효과
- "3턴마다 +1 드로우" → 카운터 상태가 있는 스킬 (state 필드)
- "전투 중 에너지 +1" → `onCombatStart` hook의 `gainEnergy(1)` 효과 (그 전투 동안만 — RunStartHook이 아니므로)

## 미정 (TBD)

- **선택형 효과 흐름** (`discardChoose`, `exhaustChoose`): 일시정지 후 재진입. ✅ 사용자 확정. 구현 세부는 Effect Executor 슬라이스에서.
- **데미지 파이프라인 순서**: outgoing modifiers → incoming modifiers → block 흡수 → hp 차감 → 사망 체크 — 슬더스와 동일. ✅ 사용자 확정.
- (잔여) **턴 종료 시 손패 한도 초과 처리** — retain 누적으로 14를 넘는 경우 강제 폐기? 안 그러기로 디자인했지만 안전망 필요. → Effect Executor 슬라이스에서 결정.
