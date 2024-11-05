export function getParams() {
  const params = new URLSearchParams(window.location.search);
  const result: { [key: string]: string } = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}
