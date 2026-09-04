export function normalizedName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function nameError(value: string, existing: string[] = [], max = 64): string | null {
  const name = normalizedName(value);
  if (!name) return "Enter a name; spaces alone are not enough.";
  if (name.length > max) return `Use ${max} characters or fewer.`;
  if (existing.some((item) => normalizedName(item).toLocaleLowerCase() === name.toLocaleLowerCase())) return "That name is already used here. Choose a different name.";
  return null;
}

export function topicsError(topics: string[]): string | null {
  if (!topics.length) return "Add at least one topic.";
  if (topics.length > 40) return "Add up to 40 topics at a time.";
  for (let index = 0; index < topics.length; index++) {
    const error = nameError(topics[index], topics.slice(0, index));
    if (error) return `Topic ${index + 1}: ${error}`;
  }
  return null;
}

export function validDuration(value: number): boolean {
  return Number.isInteger(value) && value >= 5 && value <= 240;
}
