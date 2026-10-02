import {
  type DocumentOptions,
  type DocValue,
  parse,
  parseDocument as origParseDocument,
  type ParseOptions,
  Scalar,
  Schema,
  type SchemaOptions,
  stringify,
  YAMLMap,
  YAMLSeq
} from 'yaml'
import { stringifyNumber } from 'yaml/util'
import { source } from '../_utils.ts'

const parseDocument = <T extends DocValue = DocValue>(
  source: string,
  options?: ParseOptions & DocumentOptions & SchemaOptions
) => origParseDocument<T, false>(source, options)

/** Same value, NaN-aware */
const sameValue = (a: unknown, b: unknown) =>
  Object.is(a, b) ||
  (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))

const expectNonFinite = (value: unknown, expected: number) => {
  expect(typeof value).toBe('number')
  if (Number.isNaN(expected)) {
    expect(Number.isNaN(value)).toBe(true)
    expect(Object.is(value, expected)).toBe(true)
  } else {
    expect(Object.is(value, expected)).toBe(true)
  }
}

describe('non-finite float round-trip', () => {
  const src = source`
    posInf: .inf
    negInf: -.Inf
    notNum: .NAN
    tagged: !!float .Inf
    flow: [.inf, -.inf, .NaN]
    plain: 3.14
    str: hello
  `

  for (const schema of ['core', 'yaml-1.1'] as const) {
    describe(`schema: ${schema}`, () => {
      test('parse & toJS types and values', () => {
        const doc = parseDocument(src, { schema })
        expect(doc.errors).toHaveLength(0)
        const js = doc.toJS()
        expectNonFinite(js.posInf, Infinity)
        expectNonFinite(js.negInf, -Infinity)
        expectNonFinite(js.notNum, NaN)
        expectNonFinite(js.tagged, Infinity)
        expect(Array.isArray(js.flow)).toBe(true)
        expectNonFinite(js.flow[0], Infinity)
        expectNonFinite(js.flow[1], -Infinity)
        expectNonFinite(js.flow[2], NaN)
        expect(js.plain).toBe(3.14)
        expect(js.str).toBe('hello')
      })

      test('stringify & re-parse keeps types and values', () => {
        const js1 = parseDocument(src, { schema }).toJS()
        const out1 = stringify(js1, { schema })
        const js2 = parse(out1, { schema })
        const out2 = stringify(js2, { schema })
        expect(out2).toBe(out1)
        for (const key of ['posInf', 'negInf', 'notNum', 'tagged', 'plain'])
          expect(sameValue(js2[key], js1[key])).toBe(true)
        for (let i = 0; i < 3; ++i)
          expect(sameValue(js2.flow[i], js1.flow[i])).toBe(true)
        expect(js2.str).toBe('hello')
      })

      test('document-level round-trip via toString + parseDocument', () => {
        const doc = parseDocument(src, { schema })
        const doc2 = parseDocument(doc.toString(), { schema })
        expect(doc2.errors).toHaveLength(0)
        const js1 = doc.toJS()
        const js2 = doc2.toJS()
        for (const key of ['posInf', 'negInf', 'notNum', 'tagged', 'plain'])
          expect(sameValue(js2[key], js1[key])).toBe(true)
        for (let i = 0; i < 3; ++i)
          expect(sameValue(js2.flow[i], js1.flow[i])).toBe(true)
      })

      test('node tags are not rewritten', () => {
        const doc = parseDocument<YAMLMap<Scalar, Scalar>>(src, { schema })
        // plain scalars resolved implicitly have no explicit tag
        expect(doc.get('posInf')?.tag).toBeUndefined()
        expect(doc.get('notNum')?.tag).toBeUndefined()
        // explicit tag is kept
        expect(doc.get('tagged')?.tag).toBe('tag:yaml.org,2002:float')
        const out = doc.toString()
        expect(out).toMatch('tagged: !!float ')
        const doc2 = parseDocument<YAMLMap<Scalar, Scalar>>(out, { schema })
        expect(doc2.get('posInf')?.tag).toBeUndefined()
        expect(doc2.get('tagged')?.tag).toBe('tag:yaml.org,2002:float')
      })

      test('toJS reviver sees non-finite numbers', () => {
        const doc = parseDocument(src, { schema })
        const seen: Record<string, unknown> = {}
        doc.toJS({
          reviver(key, value) {
            if (typeof key === 'string' && key) seen[key] = value
            return value
          }
        })
        expectNonFinite(seen.posInf, Infinity)
        expectNonFinite(seen.negInf, -Infinity)
        expectNonFinite(seen.notNum, NaN)
        expect(seen.plain).toBe(3.14)
      })
    })
  }

  test('custom Schema instance keeps non-finite floats stable', () => {
    const schema = new Schema({ schema: 'yaml-1.1' })
    const doc = parseDocument(src, { schema })
    expect(doc.errors).toHaveLength(0)
    const js = doc.toJS()
    expectNonFinite(js.posInf, Infinity)
    expectNonFinite(js.negInf, -Infinity)
    expectNonFinite(js.notNum, NaN)
    const js2 = parse(doc.toString(), { schema })
    for (const key of ['posInf', 'negInf', 'notNum', 'tagged'])
      expect(sameValue(js2[key], js[key])).toBe(true)
  })

  test('anchors, aliases & comments survive a round-trip', () => {
    const src = source`
      # leading comment
      a: &inf .inf # trailing comment
      b: *inf
      c: .nan
    `
    const doc = parseDocument<YAMLMap<Scalar, Scalar>>(src)
    expect(doc.errors).toHaveLength(0)
    const out = doc.toString()
    expect(out).toContain('&inf')
    expect(out).toContain('*inf')
    expect(out).toContain('# leading comment')
    expect(out).toContain('# trailing comment')
    const doc2 = parseDocument(out)
    const js = doc2.toJS()
    expectNonFinite(js.a, Infinity)
    expectNonFinite(js.b, Infinity)
    expectNonFinite(js.c, NaN)
    expect(js.b).toBe(js.a) // alias identity
  })

  test('flow collection in flow document', () => {
    const doc = parseDocument('{ a: [.inf, -.inf, .nan], b: 2.5 }')
    expect(doc.errors).toHaveLength(0)
    const js = doc.toJS()
    expectNonFinite(js.a[0], Infinity)
    expectNonFinite(js.a[1], -Infinity)
    expectNonFinite(js.a[2], NaN)
    expect(js.b).toBe(2.5)
    const js2 = parse(doc.toString())
    expectNonFinite(js2.a[0], Infinity)
    expectNonFinite(js2.a[1], -Infinity)
    expectNonFinite(js2.a[2], NaN)
    expect(js2.b).toBe(2.5)
  })
})

describe('non-finite float stringification', () => {
  test('JS values stringify to YAML 1.1 style literals', () => {
    const out = stringify({ a: Infinity, b: -Infinity, c: NaN, d: 1.5 })
    expect(out).toBe('a: .inf\nb: -.inf\nc: .nan\nd: 1.5\n')
    const js = parse(out)
    expectNonFinite(js.a, Infinity)
    expectNonFinite(js.b, -Infinity)
    expectNonFinite(js.c, NaN)
    expect(js.d).toBe(1.5)
  })

  test('literal .inf / .nan are still emitted as such', () => {
    expect(String(parseDocument('n: .inf'))).toBe('n: .inf\n')
    expect(String(parseDocument('n: -.inf'))).toBe('n: -.inf\n')
    expect(String(parseDocument('n: .nan'))).toBe('n: .nan\n')
  })

  test('capitalised literals are normalised, but keep their value', () => {
    for (const schema of ['core', 'yaml-1.1'] as const) {
      const doc = parseDocument('a: .Inf\nb: -.INF\nc: .NAN\n', { schema })
      expect(doc.errors).toHaveLength(0)
      const js = doc.toJS()
      expectNonFinite(js.a, Infinity)
      expectNonFinite(js.b, -Infinity)
      expectNonFinite(js.c, NaN)
      const js2 = parse(doc.toString(), { schema })
      expectNonFinite(js2.a, Infinity)
      expectNonFinite(js2.b, -Infinity)
      expectNonFinite(js2.c, NaN)
    }
  })

  test('a programmatic Infinity with finite source is emitted as .inf', () => {
    const doc = parseDocument('n: 1')
    doc.set('n', Infinity)
    expect(String(doc)).toBe('n: .inf\n')
  })

  test('strings that look like non-finite floats stay strings', () => {
    const out = stringify({ a: '.inf', b: '-.inf', c: '.nan', d: '42' })
    expect(out).toBe('a: ".inf"\nb: "-.inf"\nc: ".nan"\nd: "42"\n')
    const js = parse(out)
    expect(js).toEqual({ a: '.inf', b: '-.inf', c: '.nan', d: '42' })
  })

  test('JSON schema keeps .inf & .nan as strings with errors', () => {
    const doc = parseDocument('"a": .inf\n"b": .nan\n', { schema: 'json' })
    expect(doc.errors).toHaveLength(2)
    expect(doc.toJS()).toEqual({ a: '.inf', b: '.nan' })
    doc.errors = []
    const js = parse(doc.toString(), { schema: 'json' })
    expect(js).toEqual({ a: '.inf', b: '.nan' })
  })
})

describe('overflowing values keep their source (#660)', () => {
  test('float overflowing to Infinity round-trips via its source', () => {
    const doc = parseDocument('gitsha: 61e9540')
    expect(doc.toJS()).toEqual({ gitsha: Infinity })
    expect(String(doc)).toBe('gitsha: 61e9540\n')
    expect(parseDocument(String(doc)).toJS()).toEqual({ gitsha: Infinity })
  })

  test('negative overflow keeps its source', () => {
    const doc = parseDocument('n: -61e9540')
    expect(doc.toJS()).toEqual({ n: -Infinity })
    expect(String(doc)).toBe('n: -61e9540\n')
  })

  test('huge integer literals keep their source', () => {
    const big = '9'.repeat(400)
    const doc = parseDocument(`n: ${big}`)
    expect(doc.toJS()).toEqual({ n: Infinity })
    expect(String(doc)).toBe(`n: ${big}\n`)
  })

  test('a YAML 1.1 float with underscores that overflows keeps its source', () => {
    const doc = parseDocument('val: 6_1e9540', { version: '1.1' })
    expect(doc.toJS()).toEqual({ val: Infinity })
    expect(String(doc)).toBe('val: 6_1e9540\n')
  })

  test('a YAML 1.1 integer with underscores that overflows keeps its source', () => {
    const big = `9_${'9'.repeat(399)}`
    const doc = parseDocument(`val: ${big}`, { version: '1.1' })
    expect(doc.toJS()).toEqual({ val: Infinity })
    expect(String(doc)).toBe(`val: ${big}\n`)
  })

  test('editing the value of a node parsed from a non-finite source is reflected', () => {
    const doc = parseDocument('n: 61e9540')
    const node = doc.get('n') as Scalar<number>
    node.value = -Infinity
    expect(String(doc)).toBe('n: -.inf\n')
  })

  test('the source is used only while it still resolves to the value', () => {
    const node = new Scalar(Infinity)
    node.source = '61e9540'
    expect(stringifyNumber(node)).toBe('61e9540')
    node.source = '5'
    expect(stringifyNumber(node)).toBe('.inf')
  })

  test('finite numbers are not affected by source keeping', () => {
    const doc = parseDocument('a: 3.14\nb: 1e5\nc: 42')
    expect(doc.toJS()).toEqual({ a: 3.14, b: 100000, c: 42 })
    const js = parse(String(doc))
    expect(js).toEqual({ a: 3.14, b: 100000, c: 42 })
  })
})

describe('explicit !!float tag on non-finite values', () => {
  test('tagged values resolve and round-trip', () => {
    const src = 'a: !!float .inf\nb: !!float -.Inf\nc: !!float .NAN\n'
    const doc = parseDocument<YAMLMap<Scalar, Scalar>>(src)
    expect(doc.errors).toHaveLength(0)
    const js = doc.toJS()
    expectNonFinite(js.a, Infinity)
    expectNonFinite(js.b, -Infinity)
    expectNonFinite(js.c, NaN)
    const out = doc.toString()
    const doc2 = parseDocument<YAMLMap<Scalar, Scalar>>(out)
    expect(doc2.errors).toHaveLength(0)
    const js2 = doc2.toJS()
    expectNonFinite(js2.a, Infinity)
    expectNonFinite(js2.b, -Infinity)
    expectNonFinite(js2.c, NaN)
    expect(doc2.get('a')?.tag).toBe('tag:yaml.org,2002:float')
  })

  test('tagged flow seq items', () => {
    const doc = parseDocument<YAMLSeq>('[!!float .inf, !!float .nan]')
    expect(doc.errors).toHaveLength(0)
    const js = doc.toJS()
    expectNonFinite(js[0], Infinity)
    expectNonFinite(js[1], NaN)
    const js2 = parse(doc.toString())
    expectNonFinite(js2[0], Infinity)
    expectNonFinite(js2[1], NaN)
  })
})
