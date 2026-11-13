/** Reference for built-in functions: drives autocomplete, signature help and docs. */
export interface FnDoc {
  name: string;
  sig: string;
  desc: string;
  cat: 'Arithmetic' | 'Powers & roots' | 'Logarithms' | 'Trigonometry' | 'Hyperbolic' | 'Combinatorics' | 'Number theory' | 'Calculus' | 'Statistics' | 'Probability' | 'Matrices' | 'Complex' | 'Rounding' | 'Units & misc';
}

export const FN_DOCS: FnDoc[] = [
  { name: 'sqrt', sig: 'sqrt(x)', desc: 'Square root', cat: 'Powers & roots' },
  { name: 'cbrt', sig: 'cbrt(x)', desc: 'Cube root (real for negative x)', cat: 'Powers & roots' },
  { name: 'root', sig: 'root(x, n)', desc: 'n-th root (real for odd n)', cat: 'Powers & roots' },
  { name: 'exp', sig: 'exp(x)', desc: 'e raised to x', cat: 'Powers & roots' },
  { name: 'pow', sig: 'pow(x, y)', desc: 'x raised to y', cat: 'Powers & roots' },
  { name: 'hypot', sig: 'hypot(a, b, …)', desc: 'Square root of the sum of squares', cat: 'Powers & roots' },
  { name: 'ln', sig: 'ln(x)', desc: 'Natural logarithm', cat: 'Logarithms' },
  { name: 'log', sig: 'log(x [, base])', desc: 'Base-10 logarithm, or logarithm in any base', cat: 'Logarithms' },
  { name: 'log2', sig: 'log2(x)', desc: 'Base-2 logarithm', cat: 'Logarithms' },
  { name: 'log10', sig: 'log10(x)', desc: 'Base-10 logarithm', cat: 'Logarithms' },
  { name: 'sin', sig: 'sin(θ)', desc: 'Sine (uses the current angle unit)', cat: 'Trigonometry' },
  { name: 'cos', sig: 'cos(θ)', desc: 'Cosine', cat: 'Trigonometry' },
  { name: 'tan', sig: 'tan(θ)', desc: 'Tangent', cat: 'Trigonometry' },
  { name: 'sec', sig: 'sec(θ)', desc: 'Secant', cat: 'Trigonometry' },
  { name: 'csc', sig: 'csc(θ)', desc: 'Cosecant', cat: 'Trigonometry' },
  { name: 'cot', sig: 'cot(θ)', desc: 'Cotangent', cat: 'Trigonometry' },
  { name: 'asin', sig: 'asin(x)', desc: 'Inverse sine', cat: 'Trigonometry' },
  { name: 'acos', sig: 'acos(x)', desc: 'Inverse cosine', cat: 'Trigonometry' },
  { name: 'atan', sig: 'atan(x)', desc: 'Inverse tangent', cat: 'Trigonometry' },
  { name: 'atan2', sig: 'atan2(y, x)', desc: 'Angle of the point (x, y)', cat: 'Trigonometry' },
  { name: 'deg2rad', sig: 'deg2rad(x)', desc: 'Degrees to radians', cat: 'Trigonometry' },
  { name: 'rad2deg', sig: 'rad2deg(x)', desc: 'Radians to degrees', cat: 'Trigonometry' },
  { name: 'sinh', sig: 'sinh(x)', desc: 'Hyperbolic sine', cat: 'Hyperbolic' },
  { name: 'cosh', sig: 'cosh(x)', desc: 'Hyperbolic cosine', cat: 'Hyperbolic' },
  { name: 'tanh', sig: 'tanh(x)', desc: 'Hyperbolic tangent', cat: 'Hyperbolic' },
  { name: 'asinh', sig: 'asinh(x)', desc: 'Inverse hyperbolic sine', cat: 'Hyperbolic' },
  { name: 'acosh', sig: 'acosh(x)', desc: 'Inverse hyperbolic cosine', cat: 'Hyperbolic' },
  { name: 'atanh', sig: 'atanh(x)', desc: 'Inverse hyperbolic tangent', cat: 'Hyperbolic' },
  { name: 'abs', sig: 'abs(x)', desc: 'Absolute value (also |x|)', cat: 'Arithmetic' },
  { name: 'sign', sig: 'sign(x)', desc: 'Sign: −1, 0 or 1', cat: 'Arithmetic' },
  { name: 'mod', sig: 'mod(a, b)', desc: 'Remainder of a ÷ b (also: a mod b)', cat: 'Arithmetic' },
  { name: 'min', sig: 'min(a, b, …)', desc: 'Smallest value', cat: 'Arithmetic' },
  { name: 'max', sig: 'max(a, b, …)', desc: 'Largest value', cat: 'Arithmetic' },
  { name: 'round', sig: 'round(x [, digits])', desc: 'Round to nearest (optionally to decimals)', cat: 'Rounding' },
  { name: 'floor', sig: 'floor(x)', desc: 'Round down', cat: 'Rounding' },
  { name: 'ceil', sig: 'ceil(x)', desc: 'Round up', cat: 'Rounding' },
  { name: 'fix', sig: 'fix(x)', desc: 'Round toward zero', cat: 'Rounding' },
  { name: 'ipart', sig: 'ipart(x)', desc: 'Integer part', cat: 'Rounding' },
  { name: 'fpart', sig: 'fpart(x)', desc: 'Fractional part', cat: 'Rounding' },
  { name: 'factorial', sig: 'factorial(n)', desc: 'n! (also written n!)', cat: 'Combinatorics' },
  { name: 'gamma', sig: 'gamma(x)', desc: 'Gamma function Γ(x)', cat: 'Combinatorics' },
  { name: 'nCr', sig: 'nCr(n, r)', desc: 'Combinations: ways to choose r of n', cat: 'Combinatorics' },
  { name: 'nPr', sig: 'nPr(n, r)', desc: 'Permutations: ordered choices of r from n', cat: 'Combinatorics' },
  { name: 'gcd', sig: 'gcd(a, b, …)', desc: 'Greatest common divisor', cat: 'Number theory' },
  { name: 'lcm', sig: 'lcm(a, b, …)', desc: 'Least common multiple', cat: 'Number theory' },
  { name: 'isPrime', sig: 'isPrime(n)', desc: 'Whether n is prime', cat: 'Number theory' },
  { name: 'primeFactors', sig: 'primeFactors(n)', desc: 'Prime factorisation as a list', cat: 'Number theory' },
  { name: 'integral', sig: 'integral(f, x, a, b)', desc: 'Definite integral of f with respect to x from a to b', cat: 'Calculus' },
  { name: 'diff', sig: 'diff(f, x, a [, order])', desc: 'Derivative of f with respect to x at x = a', cat: 'Calculus' },
  { name: 'sigma', sig: 'sigma(f, n, a, b)', desc: 'Sum of f for n from a to b (b may be Infinity)', cat: 'Calculus' },
  { name: 'product', sig: 'product(f, n, a, b)', desc: 'Product of f for n from a to b', cat: 'Calculus' },
  { name: 'limit', sig: 'limit(f, x, a)', desc: 'Limit of f as x approaches a (a may be ±Infinity)', cat: 'Calculus' },
  { name: 'nsolve', sig: 'nsolve(f, x [, guess])', desc: 'Solve f = 0 for x numerically', cat: 'Calculus' },
  { name: 'mean', sig: 'mean(a, b, …)', desc: 'Arithmetic mean', cat: 'Statistics' },
  { name: 'median', sig: 'median(a, b, …)', desc: 'Median', cat: 'Statistics' },
  { name: 'mode', sig: 'mode(a, b, …)', desc: 'Most frequent values', cat: 'Statistics' },
  { name: 'std', sig: 'std(a, b, …)', desc: 'Sample standard deviation', cat: 'Statistics' },
  { name: 'variance', sig: 'variance(a, b, …)', desc: 'Sample variance', cat: 'Statistics' },
  { name: 'sum', sig: 'sum(a, b, …)', desc: 'Sum of values', cat: 'Statistics' },
  { name: 'normalpdf', sig: 'normalpdf(x [, μ, σ])', desc: 'Normal probability density', cat: 'Probability' },
  { name: 'normalcdf', sig: 'normalcdf(lo, hi [, μ, σ])', desc: 'Normal probability P(lo ≤ X ≤ hi)', cat: 'Probability' },
  { name: 'invNorm', sig: 'invNorm(p [, μ, σ])', desc: 'Inverse normal (quantile)', cat: 'Probability' },
  { name: 'tcdf', sig: 'tcdf(lo, hi, df)', desc: 'Student t probability', cat: 'Probability' },
  { name: 'invT', sig: 'invT(p, df)', desc: 'Inverse Student t', cat: 'Probability' },
  { name: 'chi2cdf', sig: 'chi2cdf(lo, hi, df)', desc: 'Chi-square probability', cat: 'Probability' },
  { name: 'binompdf', sig: 'binompdf(n, p, k)', desc: 'Binomial P(X = k)', cat: 'Probability' },
  { name: 'binomcdf', sig: 'binomcdf(n, p, k)', desc: 'Binomial P(X ≤ k)', cat: 'Probability' },
  { name: 'poissonpdf', sig: 'poissonpdf(λ, k)', desc: 'Poisson P(X = k)', cat: 'Probability' },
  { name: 'poissoncdf', sig: 'poissoncdf(λ, k)', desc: 'Poisson P(X ≤ k)', cat: 'Probability' },
  { name: 'rand', sig: 'rand()', desc: 'Random number in [0, 1)', cat: 'Probability' },
  { name: 'randInt', sig: 'randInt(a, b)', desc: 'Random integer from a to b', cat: 'Probability' },
  { name: 'det', sig: 'det(M)', desc: 'Determinant', cat: 'Matrices' },
  { name: 'inv', sig: 'inv(M)', desc: 'Matrix inverse', cat: 'Matrices' },
  { name: 'transpose', sig: 'transpose(M)', desc: 'Transpose', cat: 'Matrices' },
  { name: 'trace', sig: 'trace(M)', desc: 'Sum of the diagonal', cat: 'Matrices' },
  { name: 'dot', sig: 'dot(u, v)', desc: 'Dot product', cat: 'Matrices' },
  { name: 'cross', sig: 'cross(u, v)', desc: 'Cross product of 3-vectors', cat: 'Matrices' },
  { name: 'norm', sig: 'norm(v [, p])', desc: 'Vector or matrix norm', cat: 'Matrices' },
  { name: 'identity', sig: 'identity(n)', desc: 'n×n identity matrix', cat: 'Matrices' },
  { name: 're', sig: 're(z)', desc: 'Real part', cat: 'Complex' },
  { name: 'im', sig: 'im(z)', desc: 'Imaginary part', cat: 'Complex' },
  { name: 'arg', sig: 'arg(z)', desc: 'Argument (angle) of z', cat: 'Complex' },
  { name: 'conj', sig: 'conj(z)', desc: 'Complex conjugate', cat: 'Complex' },
  { name: 'to', sig: 'value unit to unit', desc: 'Unit conversion, e.g. 5 km to mi', cat: 'Units & misc' },
  { name: 'erf', sig: 'erf(x)', desc: 'Error function', cat: 'Units & misc' },
];

export const FN_BY_NAME = new Map(FN_DOCS.map((d) => [d.name, d]));

/** Find the innermost function call around the cursor and which argument it is in. */
export function signatureAt(text: string, cursor: number): { doc: FnDoc; arg: number } | null {
  let depth = 0;
  let arg = 0;
  for (let i = cursor - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        const m = text.slice(0, i).match(/([A-Za-z_]\w*)\s*$/);
        if (!m) return null;
        const doc = FN_BY_NAME.get(m[1]);
        return doc ? { doc, arg } : null;
      }
      depth--;
    } else if (c === ',' && depth === 0) arg++;
  }
  return null;
}

/** Split a signature into its argument names for highlighting. */
export function sigParts(sig: string): { name: string; args: string[] } {
  const m = sig.match(/^(\w+)\((.*)\)$/);
  if (!m) return { name: sig, args: [] };
  return { name: m[1], args: m[2].split(',').map((s) => s.trim()) };
}

export const CONSTANTS: { sym: string; name: string; insert: string; value: string }[] = [
  { sym: 'π', name: 'Pi', insert: 'π', value: '3.14159265358979' },
  { sym: 'e', name: "Euler's number", insert: 'e', value: '2.71828182845905' },
  { sym: 'φ', name: 'Golden ratio', insert: 'phi', value: '1.61803398874989' },
  { sym: 'τ', name: 'Tau (2π)', insert: 'tau', value: '6.28318530717959' },
  { sym: 'c', name: 'Speed of light', insert: 'speedOfLight', value: '299 792 458 m/s' },
  { sym: 'G', name: 'Gravitational constant', insert: 'gravitationConstant', value: '6.6743e-11 m³/(kg·s²)' },
  { sym: 'g', name: 'Standard gravity', insert: 'gravity', value: '9.80665 m/s²' },
  { sym: 'h', name: 'Planck constant', insert: 'planckConstant', value: '6.62607015e-34 J·s' },
  { sym: 'ħ', name: 'Reduced Planck constant', insert: 'reducedPlanckConstant', value: '1.054571817e-34 J·s' },
  { sym: 'kB', name: 'Boltzmann constant', insert: 'boltzmann', value: '1.380649e-23 J/K' },
  { sym: 'NA', name: 'Avogadro constant', insert: 'avogadro', value: '6.02214076e23 /mol' },
  { sym: 'R', name: 'Molar gas constant', insert: 'gasConstant', value: '8.314462618 J/(mol·K)' },
  { sym: 'e⁻', name: 'Elementary charge', insert: 'elementaryCharge', value: '1.602176634e-19 C' },
  { sym: 'mₑ', name: 'Electron mass', insert: 'electronMass', value: '9.1093837e-31 kg' },
  { sym: 'mₚ', name: 'Proton mass', insert: 'protonMass', value: '1.67262192e-27 kg' },
  { sym: 'ε₀', name: 'Vacuum permittivity', insert: 'vacuumPermittivity', value: '8.8541878128e-12 F/m' },
  { sym: 'μ₀', name: 'Vacuum permeability', insert: 'vacuumPermeability', value: '1.25663706212e-6 N/A²' },
  { sym: 'F', name: 'Faraday constant', insert: 'faraday', value: '96485.33212 C/mol' },
  { sym: 'σ', name: 'Stefan–Boltzmann constant', insert: 'stefanBoltzmann', value: '5.670374419e-8 W/(m²·K⁴)' },
  { sym: 'atm', name: 'Standard atmosphere', insert: 'atm', value: '101325 Pa' },
];
