// 単体テスト系(actual/expectedの構造比較)向けの check アダプタ。
// run-all.mjs の check(name, cond) はブール条件しか取らないため、不一致時に
// actual/expected をチェック名へ埋め込んでデバッグしやすくする。
export function checkEqual(check, name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(ok ? name : `${name} (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`, ok);
}
