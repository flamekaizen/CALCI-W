/**
 * Unit conversion catalogue built on math.js units, plus non-linear
 * conversions (fuel economy) that math.js cannot express.
 */
import { createMath } from './math.js';

export interface UnitDef {
  id: string;
  label: string;
  symbol: string;
}

export interface UnitCategory {
  id: string;
  label: string;
  units: UnitDef[];
  /** Custom converter for non-linear categories. */
  convert?: (value: number, from: string, to: string) => number;
}

const u = (id: string, label: string, symbol = id): UnitDef => ({ id, label, symbol });

const FUEL: Record<string, { toLper100: (v: number) => number; from: (l: number) => number }> = {
  'L/100km': { toLper100: (v) => v, from: (l) => l },
  'km/L': { toLper100: (v) => 100 / v, from: (l) => 100 / l },
  'mpg(US)': { toLper100: (v) => 235.214583 / v, from: (l) => 235.214583 / l },
  'mpg(UK)': { toLper100: (v) => 282.480936 / v, from: (l) => 282.480936 / l },
};

export const UNIT_CATEGORIES: UnitCategory[] = [
  {
    id: 'length',
    label: 'Length',
    units: [
      u('nm', 'Nanometre'), u('um', 'Micrometre', 'µm'), u('mm', 'Millimetre'), u('cm', 'Centimetre'), u('m', 'Metre'),
      u('km', 'Kilometre'), u('inch', 'Inch', 'in'), u('ft', 'Foot'), u('yd', 'Yard'), u('mi', 'Mile'),
      u('nmi', 'Nautical mile'), u('angstrom', 'Ångström', 'Å'), u('au', 'Astronomical unit', 'AU'), u('lightyear', 'Light-year', 'ly'), u('parsec', 'Parsec', 'pc'),
    ],
  },
  {
    id: 'mass',
    label: 'Mass',
    units: [
      u('mg', 'Milligram'), u('g', 'Gram'), u('kg', 'Kilogram'), u('tonne', 'Tonne', 't'), u('oz', 'Ounce'),
      u('lbm', 'Pound', 'lb'), u('stone', 'Stone', 'st'), u('ton', 'Short ton (US)'), u('carat', 'Carat', 'ct'), u('grain', 'Grain', 'gr'), u('u', 'Atomic mass unit', 'u'),
    ],
  },
  {
    id: 'time',
    label: 'Time',
    units: [
      u('ns', 'Nanosecond'), u('us', 'Microsecond', 'µs'), u('ms', 'Millisecond'), u('s', 'Second'), u('minute', 'Minute', 'min'),
      u('hour', 'Hour', 'h'), u('day', 'Day', 'd'), u('week', 'Week', 'wk'), u('month', 'Month (avg)', 'mo'), u('year', 'Year', 'yr'), u('decade', 'Decade'), u('century', 'Century'),
    ],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    units: [u('degC', 'Celsius', '°C'), u('degF', 'Fahrenheit', '°F'), u('K', 'Kelvin', 'K'), u('degR', 'Rankine', '°R')],
  },
  {
    id: 'area',
    label: 'Area',
    units: [
      u('mm2', 'Square millimetre', 'mm²'), u('cm2', 'Square centimetre', 'cm²'), u('m2', 'Square metre', 'm²'), u('hectare', 'Hectare', 'ha'),
      u('km2', 'Square kilometre', 'km²'), u('sqin', 'Square inch', 'in²'), u('sqft', 'Square foot', 'ft²'), u('sqyd', 'Square yard', 'yd²'), u('acre', 'Acre', 'ac'), u('sqmi', 'Square mile', 'mi²'),
    ],
  },
  {
    id: 'volume',
    label: 'Volume',
    units: [
      u('mL', 'Millilitre'), u('L', 'Litre'), u('m3', 'Cubic metre', 'm³'), u('cm3', 'Cubic centimetre', 'cm³'), u('cuin', 'Cubic inch', 'in³'),
      u('cuft', 'Cubic foot', 'ft³'), u('teaspoon', 'Teaspoon (US)', 'tsp'), u('tablespoon', 'Tablespoon (US)', 'tbsp'), u('floz', 'Fluid ounce (US)', 'fl oz'), u('cup', 'Cup (US)'),
      u('pint', 'Pint (US)', 'pt'), u('quart', 'Quart (US)', 'qt'), u('gallon', 'Gallon (US)', 'gal'), u('barrel', 'Barrel (oil)', 'bbl'),
    ],
  },
  {
    id: 'speed',
    label: 'Speed',
    units: [u('m/s', 'Metres per second'), u('km/h', 'Kilometres per hour'), u('mi/h', 'Miles per hour', 'mph'), u('ft/s', 'Feet per second'), u('knot', 'Knot', 'kn'), u('c', 'Speed of light (c)')],
  },
  {
    id: 'acceleration',
    label: 'Acceleration',
    units: [u('m/s^2', 'Metres per second²', 'm/s²'), u('ft/s^2', 'Feet per second²', 'ft/s²'), u('gforce', 'Standard gravity', 'g₀'), u('Gal', 'Gal (cm/s²)', 'Gal')],
  },
  {
    id: 'pressure',
    label: 'Pressure',
    units: [u('Pa', 'Pascal'), u('kPa', 'Kilopascal'), u('MPa', 'Megapascal'), u('bar', 'Bar'), u('mbar', 'Millibar'), u('atm', 'Atmosphere'), u('psi', 'PSI'), u('mmHg', 'mm of mercury'), u('inHg', 'Inch of mercury'), u('torr', 'Torr')],
  },
  {
    id: 'energy',
    label: 'Energy',
    units: [u('J', 'Joule'), u('kJ', 'Kilojoule'), u('MJ', 'Megajoule'), u('cal', 'Calorie'), u('kcal', 'Kilocalorie'), u('Wh', 'Watt-hour'), u('kWh', 'Kilowatt-hour'), u('eV', 'Electronvolt'), u('BTU', 'BTU'), u('erg', 'Erg')],
  },
  {
    id: 'power',
    label: 'Power',
    units: [u('mW', 'Milliwatt'), u('W', 'Watt'), u('kW', 'Kilowatt'), u('MW', 'Megawatt'), u('hp', 'Horsepower (mech.)'), u('BTU/h', 'BTU per hour'), u('erg/s', 'Erg per second')],
  },
  {
    id: 'force',
    label: 'Force',
    units: [u('N', 'Newton'), u('kN', 'Kilonewton'), u('dyn', 'Dyne'), u('lbf', 'Pound-force'), u('kip', 'Kip'), u('kgf', 'Kilogram-force')],
  },
  {
    id: 'data',
    label: 'Data',
    units: [
      u('b', 'Bit'), u('B', 'Byte'), u('kB', 'Kilobyte'), u('KiB', 'Kibibyte'), u('MB', 'Megabyte'), u('MiB', 'Mebibyte'),
      u('GB', 'Gigabyte'), u('GiB', 'Gibibyte'), u('TB', 'Terabyte'), u('TiB', 'Tebibyte'), u('PB', 'Petabyte'), u('PiB', 'Pebibyte'),
    ],
  },
  {
    id: 'datarate',
    label: 'Data rate',
    units: [u('b/s', 'Bits per second', 'bps'), u('kb/s', 'Kilobits per second', 'kbps'), u('Mb/s', 'Megabits per second', 'Mbps'), u('Gb/s', 'Gigabits per second', 'Gbps'), u('B/s', 'Bytes per second'), u('MB/s', 'Megabytes per second'), u('GB/s', 'Gigabytes per second')],
  },
  {
    id: 'angle',
    label: 'Angle',
    units: [u('deg', 'Degree', '°'), u('rad', 'Radian'), u('grad', 'Gradian', 'gon'), u('arcmin', 'Arcminute', "'"), u('arcsec', 'Arcsecond', '"'), u('cycle', 'Turn', 'rev')],
  },
  {
    id: 'frequency',
    label: 'Frequency',
    units: [u('Hz', 'Hertz'), u('kHz', 'Kilohertz'), u('MHz', 'Megahertz'), u('GHz', 'Gigahertz'), u('rpm', 'Revolutions per minute', 'rpm')],
  },
  {
    id: 'electric',
    label: 'Electric',
    units: [u('A', 'Ampere'), u('mA', 'Milliampere'), u('V', 'Volt'), u('mV', 'Millivolt'), u('kV', 'Kilovolt'), u('ohm', 'Ohm', 'Ω'), u('kohm', 'Kilo-ohm', 'kΩ'), u('F', 'Farad'), u('uF', 'Microfarad', 'µF'), u('C', 'Coulomb'), u('mAh', 'Milliamp-hour')],
  },
  {
    id: 'fuel',
    label: 'Fuel economy',
    units: Object.keys(FUEL).map((k) => u(k, k === 'L/100km' ? 'Litres per 100 km' : k === 'km/L' ? 'Kilometres per litre' : k === 'mpg(US)' ? 'Miles per gallon (US)' : 'Miles per gallon (UK)', k)),
    convert: (v, from, to) => FUEL[to].from(FUEL[from].toLper100(v)),
  },
];

let math: ReturnType<typeof createMath> | null = null;
let customDefined = false;

function ensureUnits() {
  math ??= createMath();
  if (customDefined) return math;
  customDefined = true;
  const define = (name: string, def: string) => {
    try {
      math!.createUnit(name, def);
    } catch {
      /* already defined */
    }
  };
  define('nmi', '1852 m');
  define('sqin', '1 inch^2');
  define('sqft', '1 ft^2');
  define('sqyd', '1 yd^2');
  define('sqmi', '1 mi^2');
  define('cuin', '1 inch^3');
  define('cuft', '1 ft^3');
  define('knot', '1852 m/hour');
  define('gforce', '9.80665 m/s^2');
  define('Gal', '0.01 m/s^2');
  define('kgf', '9.80665 N');
  define('kip', '1000 lbf');
  define('kohm', '1000 ohm');
  define('mAh', '3.6 C');
  define('rpm', '0.016666666666666666 Hz');
  define('stone', '14 lbm');
  define('carat', '0.2 g');
  define('mmHg', '133.322387415 Pa');
  define('inHg', '3386.389 Pa');
  define('lightyear', '9460730472580800 m');
  define('parsec', '30856775814913673 m');
  define('au', '149597870700 m');
  define('barrel', '158.987294928 L');
  define('cycle', '360 deg');
  return math;
}

/** Convert value between unit ids within a category. */
export function convertUnit(value: number, from: string, to: string, categoryId?: string): number {
  const cat = categoryId ? UNIT_CATEGORIES.find((c) => c.id === categoryId) : UNIT_CATEGORIES.find((c) => c.units.some((x) => x.id === from));
  if (cat?.convert) return cat.convert(value, from, to);
  const m = ensureUnits();
  const r = m.unit(value, from).toNumber(to);
  return r;
}

/** Convert a free-form "12 km to mi" style query. */
export function convertQuery(query: string): { value: number; unit: string; text: string } {
  const m = ensureUnits();
  const match = query.match(/^\s*(.+?)\s+(?:to|in|as|->)\s+(.+?)\s*$/i);
  if (!match) throw new Error('Use the form "<value> <unit> to <unit>", e.g. "5 km to mi"');
  if (query.length > 300) throw new Error('Query too long');
  // Only numbers, unit names and arithmetic are allowed — never run arbitrary expressions on this shared instance.
  const node = m.parse(`(${match[1]}) to (${match[2]})`);
  node.traverse((n: any) => {
    const ok =
      (n.type === 'ConstantNode' && typeof n.value === 'number') ||
      n.type === 'SymbolNode' ||
      n.type === 'ParenthesisNode' ||
      (n.type === 'OperatorNode' && ['add', 'subtract', 'multiply', 'divide', 'pow', 'unaryMinus', 'unaryPlus', 'to'].includes(n.fn));
    if (!ok) throw new Error('Only numbers, units and + − × ÷ ^ are allowed in a conversion');
  });
  const res = node.compile().evaluate();
  const unit = match[2].trim();
  const value = res.toNumber(unit);
  return { value, unit, text: `${m.format(value, { precision: 12 })} ${unit}` };
}

export function findCategory(id: string) {
  return UNIT_CATEGORIES.find((c) => c.id === id);
}
