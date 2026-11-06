import { createRankingSliceBudget } from '../lib/rankingSliceBudget';

function harness() {
  let now = 1000;
  return { budget: createRankingSliceBudget(() => now), at: (ms: number) => { now = ms; } };
}

describe('createRankingSliceBudget', () => {
  it('uses the larger slice while idle', () => {
    expect(harness().budget.budgetMs()).toBe(10);
  });

  it('stays at 4 ms during a touch and while the released card settles, then returns to idle', () => {
    const { budget, at } = harness();
    budget.touchStart();
    at(1200); expect(budget.budgetMs()).toBe(4);
    budget.touchEnd();
    at(1599); expect(budget.budgetMs()).toBe(4);
    at(1600); expect(budget.budgetMs()).toBe(10);
  });

  it('never stays small forever when a touch end is lost', () => {
    const { budget, at } = harness();
    budget.touchStart();
    at(5999); expect(budget.budgetMs()).toBe(4);
    at(6000); expect(budget.budgetMs()).toBe(10);
  });
});
