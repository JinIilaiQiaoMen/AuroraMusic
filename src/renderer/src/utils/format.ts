export function fmtTime(sec: number): string {
  if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}:${rs.toString().padStart(2, '0')}`
}
