import type { Scalar } from '../nodes/Scalar.ts'
import { stringifyString } from './stringifyString.ts'
import type { StringifyContext } from './stringify.ts'

export function stringifyNumber(
  node: Scalar,
  ctx?: StringifyContext,
  onComment?: () => void,
  onChompKeep?: () => void
): string {
  const { format, minFractionDigits, tag, value } = node
  if (typeof value === 'bigint') return String(value)
  // A non-number value may end up here when an explicit !!float tag is
  // attached to a value that the schema does not resolve as a number,
  // e.g. `!!float abc`. Serialize it as a string instead of coercing it
  // with Number(), which would turn arbitrary strings into NaN.
  if (typeof value !== 'number')
    return ctx
      ? stringifyString(node, ctx, onComment, onChompKeep)
      : String(value)
  if (!isFinite(value))
    return Number.isNaN(value) ? '.nan' : value < 0 ? '-.inf' : '.inf'
  let n = Object.is(value, -0) ? '-0' : JSON.stringify(value)
  if (
    !format &&
    minFractionDigits &&
    (!tag || tag === 'tag:yaml.org,2002:float') &&
    /^-?\d/.test(n) &&
    !n.includes('e')
  ) {
    let i = n.indexOf('.')
    if (i < 0) {
      i = n.length
      n += '.'
    }
    let d = minFractionDigits - (n.length - i - 1)
    while (d-- > 0) n += '0'
  }
  return n
}
