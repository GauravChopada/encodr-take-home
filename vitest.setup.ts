import "@testing-library/jest-dom/vitest";

// Newer Node versions ship an experimental global `localStorage` that, without --localstorage-file,
// shadows jsdom's and is undefined on `window`. Fall back to an in-memory Storage so tests behave the
// same on every Node version the project supports.
if (typeof window !== "undefined" && typeof window.localStorage?.getItem !== "function") {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage as Storage });
}
