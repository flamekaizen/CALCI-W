/** OpenAPI 3.1 description of the Calci REST API. */
const json = (example: unknown, description = 'Success') => ({
  description,
  content: { 'application/json': { example } },
});

const body = (example: unknown) => ({
  required: true,
  content: { 'application/json': { example } },
});

const q = (name: string, description: string, required = false, schema: Record<string, unknown> = { type: 'string' }) => ({ name, in: 'query', description, required, schema });

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Calci API',
    version: '1.1.0',
    description:
      'Free maths API: expression evaluation, symbolic derivatives, integrals, equation solving, statistics, probability, finance, unit conversion, programmer arithmetic and SVG graph rendering. Every endpoint accepts GET with query parameters or POST with a JSON body. CORS is open.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/evaluate': {
      post: {
        summary: 'Evaluate an expression (or a list of expressions sharing variables)',
        requestBody: body({ expr: 'sin(30) + sqrt(16)', angle: 'deg', digits: 12 }),
        responses: { 200: json({ expr: 'sin(30) + sqrt(16)', ok: true, result: '4.5', tex: '4.5', exact: { text: '9/2', tex: '\\frac{9}{2}' }, kind: 'number', value: 4.5 }) },
      },
      get: { summary: 'Evaluate (query form)', parameters: [q('expr', 'Expression', true), q('angle', 'rad | deg | grad'), q('digits', 'Significant digits'), q('notation', 'auto | fix | sci | eng')], responses: { 200: json({ ok: true, result: '4.5' }) } },
    },
    '/simplify': { post: { summary: 'Simplify an expression symbolically', requestBody: body({ expr: '2x + 3x - x^2/x' }), responses: { 200: json({ result: '4 * x', tex: '4~x' }) } } },
    '/derivative': {
      post: { summary: 'Symbolic derivative, optionally evaluated at a point', requestBody: body({ expr: 'x^2 sin(x)', variable: 'x', order: 1, at: 1 }), responses: { 200: json({ result: '2 * x * sin(x) + x ^ 2 * cos(x)', tex: '…', valueAt: { at: 1, value: 2.2232442755 } }) } },
    },
    '/integral': { post: { summary: 'Definite integral (supports Infinity bounds)', requestBody: body({ expr: 'e^(-x^2)', a: '-Infinity', b: 'Infinity' }), responses: { 200: json({ value: 1.7724538509055, errorEstimate: 1e-14 }) } } },
    '/limit': { post: { summary: 'Numeric limit', requestBody: body({ expr: 'sin(x)/x', at: 0 }), responses: { 200: json({ value: 1, exists: true }) } } },
    '/taylor': { post: { summary: 'Taylor polynomial', requestBody: body({ expr: 'cos(x)', at: 0, order: 6 }), responses: { 200: json({ coefficients: [1, 0, -0.5, 0, 0.0416666666667, 0, -0.00138888888889], text: '1 - 1/2*x^2 + 1/24*x^4 - 1/720*x^6' }) } } },
    '/solve': {
      post: {
        summary: 'Solve polynomials, linear systems or any equation',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              examples: {
                polynomial: { value: { type: 'polynomial', coefficients: [1, -6, 11, -6] } },
                linear: { value: { type: 'linear', A: [[2, 1], [1, 3]], b: [3, 5] } },
                equation: { value: { type: 'equation', equation: 'cos(x) = x', min: -10, max: 10 } },
              },
            },
          },
        },
        responses: { 200: json({ roots: [{ re: 1, im: 0 }, { re: 2, im: 0 }, { re: 3, im: 0 }] }) },
      },
    },
    '/stats': { post: { summary: 'Descriptive statistics and regression', requestBody: body({ data: [1, 2, 3, 4], y: [3, 5, 7, 9], model: 'linear' }), responses: { 200: json({ summary: { n: 4, mean: 2.5 }, regression: { params: { a: 2, b: 1 }, r2: 1 } }) } } },
    '/distribution': { post: { summary: 'Probability distributions: pdf, cdf, interval probability, quantile', requestBody: body({ dist: 'normal', mu: 0, sigma: 1, a: -1.96, b: 1.96, p: 0.975 }), responses: { 200: json({ probability: 0.95000420970356, quantile: 1.959963984540054 }) } } },
    '/convert': { post: { summary: 'Unit conversion', requestBody: body({ value: 100, from: 'degC', to: 'degF' }), responses: { 200: json({ value: 212 }) } } },
    '/units': { get: { summary: 'List unit categories and unit ids', responses: { 200: json({ categories: [] }) } } },
    '/programmer': { post: { summary: 'Integer/bitwise arithmetic in any base and word size', requestBody: body({ expr: 'FF AND 0F', base: 16, word: 32, signed: true }), responses: { 200: json({ dec: '15', hex: 'F', oct: '17', bin: '1111' }) } } },
    '/finance': {
      post: {
        summary: 'Financial calculations: tvm, amortization, npv, irr, loan',
        requestBody: body({ op: 'tvm', solve: 'pmt', n: 360, iy: 6, pv: 200000, fv: 0, py: 12, cy: 12 }),
        responses: { 200: json({ solve: 'pmt', value: -1199.10105 }) },
      },
    },
    '/plot': {
      get: {
        summary: 'Render a graph as SVG — usable directly in <img src>',
        parameters: [q('expr', 'Expression (repeatable)', true), q('xmin', 'Left edge'), q('xmax', 'Right edge'), q('ymin', 'Bottom edge'), q('ymax', 'Top edge'), q('width', 'Pixels'), q('height', 'Pixels'), q('theme', 'light | dark')],
        responses: { 200: { description: 'SVG image', content: { 'image/svg+xml': {} } } },
      },
    },
    '/functions': { get: { summary: 'Reference of built-in functions', responses: { 200: json({ functions: [] }) } } },
    '/openapi': { get: { summary: 'This document', responses: { 200: json({}) } } },
  },
};
