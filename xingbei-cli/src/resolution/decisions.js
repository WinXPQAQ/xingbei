// Both automatic play and interactive play drive the same rule iterator.
export function resolveSync(steps, decide) {
  let step = steps.next();
  while (!step.done) {
    if (step.value.type === "promise") throw new Error("同步结算不能等待异步技能");
    const choice = decide(step.value);
    if (choice?.then) throw new Error("同步结算不能等待异步决定");
    step = steps.next(choice);
  }
  return step.value;
}
export async function resolveAsync(steps, decide) {
  let step = steps.next();
  while (!step.done) step = steps.next(await (step.value.type === "promise" ? step.value.promise : decide(step.value)));
  return step.value;
}
