/* Auto-generated TypeScript code */
/* WARNING: Do not modify this file directly. It is generated from ABI definitions. */

type __TnIrNode =
  | { readonly op: "zero" }
  | { readonly op: "const"; readonly value: bigint }
  | { readonly op: "field"; readonly param: string }
  | {
      readonly op: "add";
      readonly left: __TnIrNode;
      readonly right: __TnIrNode;
    }
  | {
      readonly op: "sub";
      readonly left: __TnIrNode;
      readonly right: __TnIrNode;
    }
  | {
      readonly op: "mul";
      readonly left: __TnIrNode;
      readonly right: __TnIrNode;
    }
  | {
      readonly op:
        | "div"
        | "mod"
        | "bitAnd"
        | "bitOr"
        | "bitXor"
        | "leftShift"
        | "rightShift";
      readonly left: __TnIrNode;
      readonly right: __TnIrNode;
    }
  | {
      readonly op: "align";
      readonly alignment: number;
      readonly node: __TnIrNode;
    }
  | {
      readonly op: "switch";
      readonly tag: string;
      readonly cases: readonly { readonly value: number; readonly node: __TnIrNode }[];
      readonly default?: __TnIrNode;
    }
  | {
      readonly op: "call";
      readonly typeName: string;
      readonly args: readonly { readonly name: string; readonly source: string }[];
    }
  | {
      readonly op: "sumOverArray";
      readonly count: __TnIrNode;
      readonly elementTypeName: string;
      readonly fieldName: string;
    };

type __TnIrContext = {
  params: Record<string, bigint>;
  buffer?: Uint8Array;
  typeName?: string;
};

type __TnValidateResult = {
  ok: boolean;
  code?: string;
  consumed?: bigint;
  params?: Record<string, bigint>;
};
type __TnEvalResult =
  | { ok: true; value: bigint }
  | { ok: false; code: string };
type __TnBuilderLike = { build(): Uint8Array };
type __TnStructFieldInput =
  | Uint8Array
  | __TnBuilderLike
  | { buffer?: Uint8Array }
  | { asUint8Array?: () => Uint8Array }
  | { bytes?: () => Uint8Array };
type __TnVariantDescriptor = {
  readonly name: string;
  readonly tag: number;
  readonly payloadSize: number | null;
  readonly payloadType?: string;
  readonly createPayloadBuilder?: () => unknown | null;
};
type __TnVariantSelectorResult<Parent> = {
  select(
    name: string
  ): { writePayload(payload: Uint8Array | __TnBuilderLike): { finish(): Parent } };
  finish(): Parent;
};
type __TnFamWriterResult<Parent> = {
  write(payload: Uint8Array | __TnBuilderLike): { finish(): Parent };
  finish(): Parent;
};
type __TnConsole = { warn?: (...args: unknown[]) => void };

const __tnWarnings = new Set<string>();
const __tnHasNativeBigInt = typeof BigInt === "function";
const __tnHasBigIntDataView =
  typeof DataView !== "undefined" &&
  typeof DataView.prototype.getBigInt64 === "function" &&
  typeof DataView.prototype.getBigUint64 === "function" &&
  typeof DataView.prototype.setBigInt64 === "function" &&
  typeof DataView.prototype.setBigUint64 === "function";
const __tnConsole: __TnConsole | undefined =
  typeof globalThis !== "undefined"
    ? (globalThis as { console?: __TnConsole }).console
    : undefined;

function __tnLogWarn(message: string): void {
  if (__tnConsole && typeof __tnConsole.warn === "function") {
    __tnConsole.warn(message);
  }
}

function __tnWarnOnce(message: string): void {
  if (!__tnWarnings.has(message)) {
    __tnWarnings.add(message);
    __tnLogWarn(message);
  }
}

function __tnResolveBuilderInput(
  input: Uint8Array | __TnBuilderLike,
  context: string
): Uint8Array {
  if (input instanceof Uint8Array) {
    return new Uint8Array(input);
  }
  if (input && typeof (input as __TnBuilderLike).build === "function") {
    const built = (input as __TnBuilderLike).build();
    if (!(built instanceof Uint8Array)) {
      throw new Error(`${context}: builder did not return Uint8Array`);
    }
    return new Uint8Array(built);
  }
  throw new Error(`${context}: expected Uint8Array or builder`);
}

function __tnResolveStructFieldInput(
  input: __TnStructFieldInput,
  context: string
): Uint8Array {
  if (
    input instanceof Uint8Array ||
    (input && typeof (input as __TnBuilderLike).build === "function")
  ) {
    return __tnResolveBuilderInput(input as Uint8Array | __TnBuilderLike, context);
  }
  if (input && typeof (input as { asUint8Array?: () => Uint8Array }).asUint8Array === "function") {
    const bytes = (input as { asUint8Array: () => Uint8Array }).asUint8Array();
    return new Uint8Array(bytes);
  }
  if (input && typeof (input as { bytes?: () => Uint8Array }).bytes === "function") {
    const bytes = (input as { bytes: () => Uint8Array }).bytes();
    return new Uint8Array(bytes);
  }
  if (input && (input as { buffer?: unknown }).buffer instanceof Uint8Array) {
    return new Uint8Array((input as { buffer: Uint8Array }).buffer);
  }
  throw new Error(`${context}: expected Uint8Array, builder, or view-like value`);
}

function __tnMaybeCallBuilder(ctor: unknown): unknown | null {
  if (!ctor) {
    return null;
  }
  const builderFn = (ctor as { builder?: () => unknown }).builder;
  return typeof builderFn === "function" ? builderFn() : null;
}

function __tnCreateVariantSelector<Parent, Descriptor extends __TnVariantDescriptor>(
  parent: Parent,
  descriptors: readonly Descriptor[],
  assign: (descriptor: Descriptor, payload: Uint8Array) => void
): __TnVariantSelectorResult<Parent> {
  return {
    select(name: string) {
      const descriptor = descriptors.find((variant) => variant.name === name);
      if (!descriptor) {
        throw new Error(`Unknown variant '${name}'`);
      }
      return {
        writePayload(payload: Uint8Array | __TnBuilderLike) {
          const bytes = __tnResolveBuilderInput(
            payload,
            `variant ${descriptor.name}`
          );
          if (
            descriptor.payloadSize !== null &&
            bytes.length !== descriptor.payloadSize
          ) {
            throw new Error(
              `Payload for ${descriptor.name} must be ${descriptor.payloadSize} bytes`
            );
          }
          assign(descriptor, bytes);
          return {
            finish(): Parent {
              return parent;
            },
          };
        },
      };
    },
    finish(): Parent {
      return parent;
    },
  };
}

function __tnCreateFamWriter<Parent>(
  parent: Parent,
  fieldName: string,
  assign: (bytes: Uint8Array) => void
): __TnFamWriterResult<Parent> {
  let hasWritten = false;
  return {
    write(payload: Uint8Array | __TnBuilderLike) {
      const bytes = __tnResolveBuilderInput(
        payload,
        `flexible array '${fieldName}'`
      );
      const copy = new Uint8Array(bytes);
      assign(copy);
      hasWritten = true;
      return {
        finish(): Parent {
          return parent;
        },
      };
    },
    finish(): Parent {
      if (!hasWritten) {
        throw new Error(
          `flexible array '${fieldName}' requires write() before finish()`
        );
      }
      return parent;
    },
  };
}

const __tnMask32 = __tnHasNativeBigInt
  ? (BigInt(1) << BigInt(32)) - BigInt(1)
  : 0xffffffff;
const __tnSignBit32 = __tnHasNativeBigInt
  ? BigInt(1) << BigInt(31)
  : 0x80000000;

function __tnToBigInt(value: number | bigint): bigint {
  if (__tnHasNativeBigInt) {
    return typeof value === "bigint" ? value : BigInt(value);
  }
  if (typeof value === "bigint") return value;
  if (!Number.isFinite(value)) {
    throw new Error("IR runtime received non-finite numeric input");
  }
  if (!Number.isSafeInteger(value)) {
    __tnWarnOnce(
      `[thru-net] Precision loss while polyfilling BigInt (value=${value})`
    );
  }
  return (value as unknown) as bigint;
}

function __tnBigIntToNumber(value: bigint, context: string): number {
  if (__tnHasNativeBigInt) {
    const converted = Number(value);
    if (!Number.isFinite(converted)) {
      throw new Error(`${context} overflowed Number range`);
    }
    return converted;
  }
  return value as unknown as number;
}

function __tnBigIntEquals(lhs: bigint, rhs: bigint): boolean {
  if (__tnHasNativeBigInt) return lhs === rhs;
  return (lhs as unknown as number) === (rhs as unknown as number);
}

function __tnBigIntGreaterThan(lhs: bigint, rhs: bigint): boolean {
  if (__tnHasNativeBigInt) return lhs > rhs;
  return (lhs as unknown as number) > (rhs as unknown as number);
}

function __tnPopcount(value: number | bigint): number {
  let v =
    typeof value === "bigint"
      ? Number(value & BigInt(0xffffffff))
      : Number(value) >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function __tnRaiseIrError(code: string, message: string): never {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  throw err;
}

function __tnCheckedAdd(lhs: bigint, rhs: bigint): bigint {
  if (__tnHasNativeBigInt) {
    const result = (lhs as bigint) + (rhs as bigint);
    if (result < BigInt(0)) {
      __tnRaiseIrError(
        "tn.ir.overflow",
        "IR runtime detected negative size via addition"
      );
    }
    return result;
  }
  const left = lhs as unknown as number;
  const right = rhs as unknown as number;
  const sum = left + right;
  if (sum < 0 || !Number.isFinite(sum)) {
    __tnRaiseIrError(
      "tn.ir.overflow",
      "IR runtime detected invalid addition result"
    );
  }
  if (!Number.isSafeInteger(sum)) {
    __tnWarnOnce("[thru-net] Precision loss while polyfilling BigInt addition");
  }
  return (sum as unknown) as bigint;
}

function __tnCheckedSub(lhs: bigint, rhs: bigint): bigint {
  if (__tnHasNativeBigInt) {
    const result = (lhs as bigint) - (rhs as bigint);
    if (result < BigInt(0)) {
      __tnRaiseIrError(
        "tn.ir.overflow",
        "IR runtime detected negative size via subtraction"
      );
    }
    return result;
  }
  const left = lhs as unknown as number;
  const right = rhs as unknown as number;
  const diff = left - right;
  if (diff < 0 || !Number.isFinite(diff)) {
    __tnRaiseIrError(
      "tn.ir.overflow",
      "IR runtime detected invalid subtraction result"
    );
  }
  if (!Number.isSafeInteger(diff)) {
    __tnWarnOnce("[thru-net] Precision loss while polyfilling BigInt subtraction");
  }
  return (diff as unknown) as bigint;
}

function __tnCheckedMul(lhs: bigint, rhs: bigint): bigint {
  if (__tnHasNativeBigInt) {
    const result = (lhs as bigint) * (rhs as bigint);
    if (result < BigInt(0)) {
      __tnRaiseIrError(
        "tn.ir.overflow",
        "IR runtime detected negative size via multiplication"
      );
    }
    return result;
  }
  const left = lhs as unknown as number;
  const right = rhs as unknown as number;
  const product = left * right;
  if (product < 0 || !Number.isFinite(product)) {
    __tnRaiseIrError(
      "tn.ir.overflow",
      "IR runtime detected invalid multiplication result"
    );
  }
  if (!Number.isSafeInteger(product)) {
    __tnWarnOnce(
      "[thru-net] Precision loss while polyfilling BigInt multiplication"
    );
  }
  return (product as unknown) as bigint;
}

function __tnCheckedDiv(lhs: bigint, rhs: bigint): bigint {
  if (__tnBigIntEquals(rhs, __tnToBigInt(0))) {
    __tnRaiseIrError("tn.ir.overflow", "IR runtime division by zero");
  }
  if (__tnHasNativeBigInt) return (lhs as bigint) / (rhs as bigint);
  const quotient = Math.floor((lhs as unknown as number) / (rhs as unknown as number));
  return (quotient as unknown) as bigint;
}

function __tnCheckedMod(lhs: bigint, rhs: bigint): bigint {
  if (__tnBigIntEquals(rhs, __tnToBigInt(0))) {
    __tnRaiseIrError("tn.ir.overflow", "IR runtime modulo by zero");
  }
  if (__tnHasNativeBigInt) return (lhs as bigint) % (rhs as bigint);
  return (((lhs as unknown as number) % (rhs as unknown as number)) as unknown) as bigint;
}

function __tnBitwise(
  lhs: bigint,
  rhs: bigint,
  op: "and" | "or" | "xor"
): bigint {
  if (__tnHasNativeBigInt) {
    if (op === "and") return (lhs as bigint) & (rhs as bigint);
    if (op === "or") return (lhs as bigint) | (rhs as bigint);
    return (lhs as bigint) ^ (rhs as bigint);
  }
  const left = lhs as unknown as number;
  const right = rhs as unknown as number;
  const maxU32 = 0xffffffff;
  if (
    !Number.isInteger(left) ||
    !Number.isInteger(right) ||
    left < 0 ||
    right < 0 ||
    left > maxU32 ||
    right > maxU32
  ) {
    __tnRaiseIrError(
      "tn.ir.overflow",
      "IR runtime bitwise operation requires BigInt for values outside u32 range"
    );
  }
  const result = op === "and" ? left & right : op === "or" ? left | right : left ^ right;
  return ((result >>> 0) as unknown) as bigint;
}

function __tnCheckedShift(
  lhs: bigint,
  rhs: bigint,
  direction: "left" | "right"
): bigint {
  const amount = __tnBigIntToNumber(rhs, "IR shift amount");
  if (amount < 0 || amount >= 64 || !Number.isInteger(amount)) {
    __tnRaiseIrError("tn.ir.overflow", "IR runtime invalid shift amount");
  }
  if (__tnHasNativeBigInt) {
    const shift = BigInt(amount);
    return direction === "left" ? (lhs as bigint) << shift : (lhs as bigint) >> shift;
  }
  const value = lhs as unknown as number;
  const result = direction === "left" ? value * 2 ** amount : Math.floor(value / 2 ** amount);
  if (!Number.isSafeInteger(result)) {
    __tnWarnOnce("[thru-net] Precision loss while polyfilling BigInt shift");
  }
  return (result as unknown) as bigint;
}

function __tnAlign(value: bigint, alignment: number): bigint {
  if (alignment <= 1) return value;
  const alignBig = __tnToBigInt(alignment);
  if (__tnHasNativeBigInt) {
    const remainder = value % alignBig;
    if (__tnBigIntEquals(remainder, __tnToBigInt(0))) {
      return value;
    }
    const delta = alignBig - remainder;
    return __tnCheckedAdd(value, delta);
  }
  const current = __tnBigIntToNumber(value, "IR align");
  const alignNum = alignment >>> 0;
  const remainder = current % alignNum;
  const next = remainder === 0 ? current : current + (alignNum - remainder);
  return __tnToBigInt(next);
}

function __tnSplitUint64(value: bigint): { high: number; low: number } {
  if (__tnHasNativeBigInt) {
    const low = Number(value & (__tnMask32 as bigint));
    const high = Number((value >> BigInt(32)) & (__tnMask32 as bigint));
    return { high, low };
  }
  const num = __tnBigIntToNumber(value, "DataView.setBigUint64");
  const low = num >>> 0;
  const high = Math.floor(num / 4294967296) >>> 0;
  return { high, low };
}

function __tnSplitInt64(value: bigint): { high: number; low: number } {
  if (__tnHasNativeBigInt) {
    const low = Number(value & (__tnMask32 as bigint));
    let high = Number((value >> BigInt(32)) & (__tnMask32 as bigint));
    if ((BigInt(high) & (__tnSignBit32 as bigint)) !== BigInt(0)) {
      high -= 0x100000000;
    }
    return { high, low };
  }
  const num = __tnBigIntToNumber(value, "DataView.setBigInt64");
  const low = num >>> 0;
  const high = Math.floor(num / 4294967296);
  return { high, low };
}

function __tnPolyfillReadUint64(
  view: DataView,
  offset: number,
  littleEndian: boolean
): bigint {
  const low = littleEndian
    ? view.getUint32(offset, true)
    : view.getUint32(offset + 4, false);
  const high = littleEndian
    ? view.getUint32(offset + 4, true)
    : view.getUint32(offset, false);
  if (__tnHasNativeBigInt) {
    return (BigInt(high) << BigInt(32)) | BigInt(low);
  }
  const value = high * 4294967296 + low;
  if (!Number.isSafeInteger(value)) {
    __tnWarnOnce(
      "[thru-net] Precision loss while polyfilling DataView.getBigUint64"
    );
  }
  return (value as unknown) as bigint;
}

function __tnPolyfillReadInt64(
  view: DataView,
  offset: number,
  littleEndian: boolean
): bigint {
  const low = littleEndian
    ? view.getUint32(offset, true)
    : view.getUint32(offset + 4, false);
  const high = littleEndian
    ? view.getInt32(offset + 4, true)
    : view.getInt32(offset, false);
  if (__tnHasNativeBigInt) {
    return (BigInt(high) << BigInt(32)) | BigInt(low);
  }
  const value = high * 4294967296 + low;
  if (!Number.isSafeInteger(value)) {
    __tnWarnOnce(
      "[thru-net] Precision loss while polyfilling DataView.getBigInt64"
    );
  }
  return (value as unknown) as bigint;
}

function __tnPolyfillWriteUint64(
  view: DataView,
  offset: number,
  value: bigint,
  littleEndian: boolean
): void {
  const parts = __tnSplitUint64(value);
  if (littleEndian) {
    view.setUint32(offset, parts.low, true);
    view.setUint32(offset + 4, parts.high, true);
  } else {
    view.setUint32(offset, parts.high, false);
    view.setUint32(offset + 4, parts.low, false);
  }
}

function __tnPolyfillWriteInt64(
  view: DataView,
  offset: number,
  value: bigint,
  littleEndian: boolean
): void {
  const parts = __tnSplitInt64(value);
  if (littleEndian) {
    view.setUint32(offset, parts.low >>> 0, true);
    view.setInt32(offset + 4, parts.high | 0, true);
  } else {
    view.setInt32(offset, parts.high | 0, false);
    view.setUint32(offset + 4, parts.low >>> 0, false);
  }
}

if (typeof DataView !== "undefined" && !__tnHasBigIntDataView) {
  const proto = DataView.prototype as unknown as Record<string, unknown>;
  if (typeof proto.getBigUint64 !== "function") {
    (proto as any).getBigUint64 = function (
      offset: number,
      littleEndian?: boolean
    ): bigint {
      __tnWarnOnce(
        "[thru-net] Polyfilling DataView.getBigUint64; precision may be lost"
      );
      return __tnPolyfillReadUint64(this, offset, !!littleEndian);
    };
  }
  if (typeof proto.getBigInt64 !== "function") {
    (proto as any).getBigInt64 = function (
      offset: number,
      littleEndian?: boolean
    ): bigint {
      __tnWarnOnce(
        "[thru-net] Polyfilling DataView.getBigInt64; precision may be lost"
      );
      return __tnPolyfillReadInt64(this, offset, !!littleEndian);
    };
  }
  if (typeof proto.setBigUint64 !== "function") {
    (proto as any).setBigUint64 = function (
      offset: number,
      value: bigint,
      littleEndian?: boolean
    ): void {
      __tnWarnOnce(
        "[thru-net] Polyfilling DataView.setBigUint64; precision may be lost"
      );
      __tnPolyfillWriteUint64(this, offset, value, !!littleEndian);
    };
  }
  if (typeof proto.setBigInt64 !== "function") {
    (proto as any).setBigInt64 = function (
      offset: number,
      value: bigint,
      littleEndian?: boolean
    ): void {
      __tnWarnOnce(
        "[thru-net] Polyfilling DataView.setBigInt64; precision may be lost"
      );
      __tnPolyfillWriteInt64(this, offset, value, !!littleEndian);
    };
  }
  if (!__tnHasNativeBigInt) {
    __tnWarnOnce(
      "[thru-net] BigInt is unavailable; falling back to lossy 64-bit polyfill"
    );
  }
}

const __tnFootprintRegistry: Record<
  string,
  (params: Record<string, bigint>) => bigint
> = {};
const __tnValidateRegistry: Record<
  string,
  (buffer: Uint8Array, params: Record<string, bigint>) => __TnValidateResult
> = {};
const __tnDynamicValidateRegistry: Record<
  string,
  (buffer: Uint8Array) => __TnValidateResult
> = {};

function __tnRegisterFootprint(
  typeName: string,
  fn: (params: Record<string, bigint>) => bigint
): void {
  __tnFootprintRegistry[typeName] = fn;
}

function __tnRegisterValidate(
  typeName: string,
  fn: (buffer: Uint8Array, params: Record<string, bigint>) => __TnValidateResult
): void {
  __tnValidateRegistry[typeName] = fn;
}

function __tnRegisterDynamicValidate(
  typeName: string,
  fn: (buffer: Uint8Array) => __TnValidateResult
): void {
  __tnDynamicValidateRegistry[typeName] = fn;
}

function __tnInvokeFootprint(
  typeName: string,
  params: Record<string, bigint>
): bigint {
  const fn = __tnFootprintRegistry[typeName];
  if (!fn) throw new Error(`IR runtime missing footprint for ${typeName}`);
  return fn(params);
}

function __tnInvokeValidate(
  typeName: string,
  buffer: Uint8Array,
  params: Record<string, bigint>
): __TnValidateResult {
  const fn = __tnValidateRegistry[typeName];
  if (!fn) throw new Error(`IR runtime missing validate helper for ${typeName}`);
  return fn(buffer, params);
}

function __tnInvokeDynamicValidate(
  typeName: string,
  buffer: Uint8Array
): __TnValidateResult {
  const fn = __tnDynamicValidateRegistry[typeName];
  if (!fn) throw new Error(`IR runtime missing dynamic validate helper for ${typeName}`);
  return fn(buffer);
}

function __tnEvalFootprint(node: __TnIrNode, ctx: __TnIrContext): bigint {
  return __tnEvalIrNode(node, ctx, __tnToBigInt(0));
}

function __tnTryEvalFootprint(
  node: __TnIrNode,
  ctx: __TnIrContext
): __TnEvalResult {
  return __tnTryEvalIr(node, ctx);
}

function __tnTryEvalIr(
  node: __TnIrNode,
  ctx: __TnIrContext
): __TnEvalResult {
  try {
    return { ok: true, value: __tnEvalIrNode(node, ctx, __tnToBigInt(0)) };
  } catch (err) {
    return { ok: false, code: __tnNormalizeIrError(err) };
  }
}

function __tnIsEvalError(result: __TnEvalResult): result is { ok: false; code: string } {
  return result.ok === false;
}

function __tnValidateIrTree(
  ir: { readonly typeName: string; readonly root: __TnIrNode },
  buffer: Uint8Array,
  params: Record<string, bigint>
): __TnValidateResult {
  const evalResult = __tnTryEvalIr(ir.root, {
    params,
    buffer,
    typeName: ir.typeName,
  });
  if (__tnIsEvalError(evalResult)) {
    return { ok: false, code: evalResult.code };
  }
  const required = evalResult.value;
  const available = __tnToBigInt(buffer.length);
  if (__tnBigIntGreaterThan(required, available)) {
    return { ok: false, code: "tn.buffer_too_small", consumed: required };
  }
  return { ok: true, consumed: required };
}

function __tnEvalIrNode(
  node: __TnIrNode,
  ctx: __TnIrContext,
  baseOffset: bigint
): bigint {
  switch (node.op) {
    case "zero":
      return __tnToBigInt(0);
    case "const":
      return node.value;
    case "field": {
      if (node.param === "__buffer_size" && ctx.buffer) {
        return __tnToBigInt(ctx.buffer.length);
      }
      const val = ctx.params[node.param];
      if (val === undefined) {
        const prefix = ctx.typeName ? `${ctx.typeName}: ` : "";
        __tnRaiseIrError(
          "tn.ir.missing_param",
          `${prefix}Missing IR parameter '${node.param}'`
        );
      }
      return val;
    }
    case "add":
      {
        const left = __tnEvalIrNode(node.left, ctx, baseOffset);
        const right = __tnEvalIrNode(
          node.right,
          ctx,
          __tnCheckedAdd(baseOffset, left)
        );
        return __tnCheckedAdd(left, right);
      }
    case "sub":
      return __tnCheckedSub(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
      );
    case "mul":
      return __tnCheckedMul(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
      );
    case "div":
      return __tnCheckedDiv(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
      );
    case "mod":
      return __tnCheckedMod(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset)
      );
    case "bitAnd":
      return __tnBitwise(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "and"
      );
    case "bitOr":
      return __tnBitwise(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "or"
      );
    case "bitXor":
      return __tnBitwise(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "xor"
      );
    case "leftShift":
      return __tnCheckedShift(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "left"
      );
    case "rightShift":
      return __tnCheckedShift(
        __tnEvalIrNode(node.left, ctx, baseOffset),
        __tnEvalIrNode(node.right, ctx, baseOffset),
        "right"
      );
    case "align":
      return __tnAlign(__tnEvalIrNode(node.node, ctx, baseOffset), node.alignment);
    case "switch": {
      const tagVal = ctx.params[node.tag];
      if (tagVal === undefined) {
        const prefix = ctx.typeName ? `${ctx.typeName}: ` : "";
        __tnRaiseIrError(
          "tn.ir.missing_param",
          `${prefix}Missing IR switch tag '${node.tag}'`
        );
      }
      const tagNumber = Number(tagVal);
      for (const caseNode of node.cases) {
        if (caseNode.value === tagNumber) {
          return __tnEvalIrNode(caseNode.node, ctx, baseOffset);
        }
      }
      if (node.default) return __tnEvalIrNode(node.default, ctx, baseOffset);
      __tnRaiseIrError(
        "tn.ir.invalid_tag",
        `Unhandled IR switch value ${tagNumber} for '${node.tag}'`
      );
    }
    case "call": {
      const nestedParams: Record<string, bigint> = Object.create(null);
      for (const arg of node.args) {
        const val = ctx.params[arg.source];
        if (val === undefined) {
          const prefix = ctx.typeName ? `${ctx.typeName}: ` : "";
          __tnRaiseIrError(
            "tn.ir.missing_param",
            `${prefix}Missing IR parameter '${arg.source}' for nested call`
          );
        }
        nestedParams[arg.name] = val;
      }
      if (ctx.buffer) {
        const nestedOffset = __tnBigIntToNumber(baseOffset, "IR nested offset");
        const nestedResult = __tnInvokeValidate(
          node.typeName,
          ctx.buffer.subarray(nestedOffset),
          nestedParams
        );
        if (!nestedResult.ok) {
          const nestedCode =
            nestedResult.code ?? `tn.ir.runtime_error: ${node.typeName}`;
          const prefixed = nestedCode.startsWith("tn.")
            ? nestedCode
            : `tn.ir.runtime_error: ${node.typeName} -> ${nestedCode}`;
          __tnRaiseIrError(
            prefixed,
            `Nested validator ${node.typeName} failed`
          );
        }
        if (nestedResult.consumed !== undefined) {
          return nestedResult.consumed;
        }
      }
      return __tnInvokeFootprint(node.typeName, nestedParams);
    }
    case "sumOverArray": {
      if (!ctx.buffer) {
        __tnRaiseIrError(
          "tn.ir.missing_buffer",
          `Jagged array '${node.fieldName}' requires buffer-backed validation`
        );
      }
      const count = __tnBigIntToNumber(
        __tnEvalIrNode(node.count, ctx, baseOffset),
        `Jagged array '${node.fieldName}' count`
      );
      let cursor = __tnBigIntToNumber(baseOffset, "IR jagged array offset");
      let total = __tnToBigInt(0);
      for (let i = 0; i < count; i++) {
        const result = __tnInvokeDynamicValidate(
          node.elementTypeName,
          ctx.buffer.subarray(cursor)
        );
        if (!result.ok || result.consumed === undefined) {
          const code = result.code ?? "tn.ir.runtime_error";
          __tnRaiseIrError(
            code,
            `Jagged array '${node.fieldName}' element ${i} failed validation`
          );
        }
        cursor += __tnBigIntToNumber(result.consumed, "IR jagged element size");
        total = __tnCheckedAdd(total, result.consumed);
      }
      return total;
    }
    default:
      __tnRaiseIrError(
        "tn.ir.runtime_error",
        `Unsupported IR node ${(node as { op: string }).op}`
      );
  }
}

function __tnNormalizeIrError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const maybeCode = (err as { code?: string }).code;
    if (typeof maybeCode === "string" && maybeCode.length > 0) {
      return maybeCode;
    }
  }
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : typeof err === "string"
      ? err
      : "";
  if (message.includes("Missing IR parameter")) return "tn.ir.missing_param";
  if (message.includes("Unhandled IR switch value")) return "tn.ir.invalid_tag";
  if (
    message.includes("invalid") ||
    message.includes("overflow") ||
    message.includes("negative size")
  ) {
    return "tn.ir.overflow";
  }
  if (message.length > 0) return `tn.ir.runtime_error: ${message}`;
  return "tn.ir.runtime_error";
}

/* ----- TYPE DEFINITION FOR AddSynapseArgs ----- */

const __tn_ir_AddSynapseArgs = {
  typeName: "AddSynapseArgs",
  root: { op: "const", value: 52n }
} as const;

export class AddSynapseArgs {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): AddSynapseArgs {
    if (!buffer || buffer.length === undefined) throw new Error("AddSynapseArgs.__tnCreateView requires a Uint8Array");
    return new AddSynapseArgs(new Uint8Array(buffer));
  }

  static builder(): AddSynapseArgsBuilder {
    return new AddSynapseArgsBuilder();
  }

  static fromBuilder(builder: AddSynapseArgsBuilder): AddSynapseArgs | null {
    const buffer = builder.build();
    return AddSynapseArgs.from_array(buffer);
  }

  get_brain_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_brain_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get brain_index(): number {
    return this.get_brain_index();
  }

  set brain_index(value: number) {
    this.set_brain_index(value);
  }

  get_pre_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_pre_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get pre_index(): number {
    return this.get_pre_index();
  }

  set pre_index(value: number) {
    this.set_pre_index(value);
  }

  get_post_index(): number {
    const offset = 4;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_post_index(value: number): void {
    const offset = 4;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get post_index(): number {
    return this.get_post_index();
  }

  set post_index(value: number) {
    this.set_post_index(value);
  }

  get_pad(): number {
    const offset = 6;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_pad(value: number): void {
    const offset = 6;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get pad(): number {
    return this.get_pad();
  }

  set pad(value: number) {
    this.set_pad(value);
  }

  get_index(): number {
    const offset = 8;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_index(value: number): void {
    const offset = 8;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get index(): number {
    return this.get_index();
  }

  set index(value: number) {
    this.set_index(value);
  }

  get_pre_body_id(): bigint {
    const offset = 12;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_pre_body_id(value: bigint): void {
    const offset = 12;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get pre_body_id(): bigint {
    return this.get_pre_body_id();
  }

  set pre_body_id(value: bigint) {
    this.set_pre_body_id(value);
  }

  get_post_body_id(): bigint {
    const offset = 20;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_post_body_id(value: bigint): void {
    const offset = 20;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get post_body_id(): bigint {
    return this.get_post_body_id();
  }

  set post_body_id(value: bigint) {
    this.set_post_body_id(value);
  }

  get_pre_xyz(): number[] {
    const offset = 28;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getInt32((offset + i * 4), true));
    }
    return result;
  }

  set_pre_xyz(value: number[]): void {
    const offset = 28;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setInt32((offset + i * 4), value[i], true);
    }
  }

  get pre_xyz(): number[] {
    return this.get_pre_xyz();
  }

  set pre_xyz(value: number[]) {
    this.set_pre_xyz(value);
  }

  get_post_xyz(): number[] {
    const offset = 40;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getInt32((offset + i * 4), true));
    }
    return result;
  }

  set_post_xyz(value: number[]): void {
    const offset = 40;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setInt32((offset + i * 4), value[i], true);
    }
  }

  get post_xyz(): number[] {
    return this.get_post_xyz();
  }

  set post_xyz(value: number[]) {
    this.set_post_xyz(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_AddSynapseArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_AddSynapseArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for AddSynapseArgs');
    }
    return __tnBigIntToNumber(irResult, 'AddSynapseArgs::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 52) return { ok: false, code: "tn.buffer_too_small", consumed: 52 };
    return { ok: true, consumed: 52 };
  }

  static from_array(buffer: Uint8Array): AddSynapseArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new AddSynapseArgs(buffer);
  }

}

export class AddSynapseArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(52);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_brain_index(value: number): this {
    this.view.setUint16(0, value, true);
    return this;
  }

  set_pre_index(value: number): this {
    this.view.setUint16(2, value, true);
    return this;
  }

  set_post_index(value: number): this {
    this.view.setUint16(4, value, true);
    return this;
  }

  set_pad(value: number): this {
    this.view.setUint16(6, value, true);
    return this;
  }

  set_index(value: number): this {
    this.view.setUint32(8, value, true);
    return this;
  }

  set_pre_body_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(12, cast, true);
    return this;
  }

  set_post_body_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(20, cast, true);
    return this;
  }

  set_pre_xyz(values: number[]): this {
    if (values.length !== 3) throw new Error("pre_xyz expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 28 + i * 4;
      this.view.setInt32(byteOffset, values[i], true);
    }
    return this;
  }

  set_post_xyz(values: number[]): this {
    if (values.length !== 3) throw new Error("post_xyz expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 40 + i * 4;
      this.view.setInt32(byteOffset, values[i], true);
    }
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): AddSynapseArgs {
    const view = AddSynapseArgs.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build AddSynapseArgs");
    return view;
  }
}

__tnRegisterFootprint("AddSynapseArgs", (params) => AddSynapseArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("AddSynapseArgs", (buffer, params) => AddSynapseArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("AddSynapseArgs", (buffer) => { const result = AddSynapseArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR BrainAccountBody ----- */

const __tn_ir_BrainAccountBody = {
  typeName: "BrainAccountBody",
  root: { op: "const", value: 82n }
} as const;

export class BrainAccountBody {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): BrainAccountBody {
    if (!buffer || buffer.length === undefined) throw new Error("BrainAccountBody.__tnCreateView requires a Uint8Array");
    return new BrainAccountBody(new Uint8Array(buffer));
  }

  static builder(): BrainAccountBodyBuilder {
    return new BrainAccountBodyBuilder();
  }

  static fromBuilder(builder: BrainAccountBodyBuilder): BrainAccountBody | null {
    const buffer = builder.build();
    return BrainAccountBody.from_array(buffer);
  }

  get_pad(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 2; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_pad(value: number[]): void {
    const offset = 0;
    if (value.length !== 2) {
      throw new Error('Array length must be 2');
    }
    for (let i = 0; i < 2; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get pad(): number[] {
    return this.get_pad();
  }

  set pad(value: number[]) {
    this.set_pad(value);
  }

  get_neuron_count(): number {
    const offset = 2;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_neuron_count(value: number): void {
    const offset = 2;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get neuron_count(): number {
    return this.get_neuron_count();
  }

  set neuron_count(value: number) {
    this.set_neuron_count(value);
  }

  get_synapse_count(): number {
    const offset = 6;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_synapse_count(value: number): void {
    const offset = 6;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get synapse_count(): number {
    return this.get_synapse_count();
  }

  set synapse_count(value: number) {
    this.set_synapse_count(value);
  }

  get_neuron_total(): number {
    const offset = 10;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_neuron_total(value: number): void {
    const offset = 10;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get neuron_total(): number {
    return this.get_neuron_total();
  }

  set neuron_total(value: number) {
    this.set_neuron_total(value);
  }

  get_synapse_total(): number {
    const offset = 14;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_synapse_total(value: number): void {
    const offset = 14;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get synapse_total(): number {
    return this.get_synapse_total();
  }

  set synapse_total(value: number) {
    this.set_synapse_total(value);
  }

  get_manifest_sha256(): number[] {
    const offset = 18;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_manifest_sha256(value: number[]): void {
    const offset = 18;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get manifest_sha256(): number[] {
    return this.get_manifest_sha256();
  }

  set manifest_sha256(value: number[]) {
    this.set_manifest_sha256(value);
  }

  get_authority(): number[] {
    const offset = 50;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_authority(value: number[]): void {
    const offset = 50;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get authority(): number[] {
    return this.get_authority();
  }

  set authority(value: number[]) {
    this.set_authority(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_BrainAccountBody.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_BrainAccountBody, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for BrainAccountBody');
    }
    return __tnBigIntToNumber(irResult, 'BrainAccountBody::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 82) return { ok: false, code: "tn.buffer_too_small", consumed: 82 };
    return { ok: true, consumed: 82 };
  }

  static from_array(buffer: Uint8Array): BrainAccountBody | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new BrainAccountBody(buffer);
  }

}

export class BrainAccountBodyBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(82);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pad(values: number[]): this {
    if (values.length !== 2) throw new Error("pad expects 2 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_neuron_count(value: number): this {
    this.view.setUint32(2, value, true);
    return this;
  }

  set_synapse_count(value: number): this {
    this.view.setUint32(6, value, true);
    return this;
  }

  set_neuron_total(value: number): this {
    this.view.setUint32(10, value, true);
    return this;
  }

  set_synapse_total(value: number): this {
    this.view.setUint32(14, value, true);
    return this;
  }

  set_manifest_sha256(values: number[]): this {
    if (values.length !== 32) throw new Error("manifest_sha256 expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 18 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_authority(values: number[]): this {
    if (values.length !== 32) throw new Error("authority expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 50 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): BrainAccountBody {
    const view = BrainAccountBody.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BrainAccountBody");
    return view;
  }
}

__tnRegisterFootprint("BrainAccountBody", (params) => BrainAccountBody.__tnInvokeFootprint(params));
__tnRegisterValidate("BrainAccountBody", (buffer, params) => BrainAccountBody.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("BrainAccountBody", (buffer) => { const result = BrainAccountBody.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR BrainCreatedBody ----- */

const __tn_ir_BrainCreatedBody = {
  typeName: "BrainCreatedBody",
  root: { op: "const", value: 40n }
} as const;

export class BrainCreatedBody {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): BrainCreatedBody {
    if (!buffer || buffer.length === undefined) throw new Error("BrainCreatedBody.__tnCreateView requires a Uint8Array");
    return new BrainCreatedBody(new Uint8Array(buffer));
  }

  static builder(): BrainCreatedBodyBuilder {
    return new BrainCreatedBodyBuilder();
  }

  static fromBuilder(builder: BrainCreatedBodyBuilder): BrainCreatedBody | null {
    const buffer = builder.build();
    return BrainCreatedBody.from_array(buffer);
  }

  get_neuron_total(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_neuron_total(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get neuron_total(): number {
    return this.get_neuron_total();
  }

  set neuron_total(value: number) {
    this.set_neuron_total(value);
  }

  get_synapse_total(): number {
    const offset = 4;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_synapse_total(value: number): void {
    const offset = 4;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get synapse_total(): number {
    return this.get_synapse_total();
  }

  set synapse_total(value: number) {
    this.set_synapse_total(value);
  }

  get_manifest_sha256(): number[] {
    const offset = 8;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_manifest_sha256(value: number[]): void {
    const offset = 8;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get manifest_sha256(): number[] {
    return this.get_manifest_sha256();
  }

  set manifest_sha256(value: number[]) {
    this.set_manifest_sha256(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_BrainCreatedBody.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_BrainCreatedBody, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for BrainCreatedBody');
    }
    return __tnBigIntToNumber(irResult, 'BrainCreatedBody::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 40) return { ok: false, code: "tn.buffer_too_small", consumed: 40 };
    return { ok: true, consumed: 40 };
  }

  static from_array(buffer: Uint8Array): BrainCreatedBody | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new BrainCreatedBody(buffer);
  }

}

export class BrainCreatedBodyBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(40);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_neuron_total(value: number): this {
    this.view.setUint32(0, value, true);
    return this;
  }

  set_synapse_total(value: number): this {
    this.view.setUint32(4, value, true);
    return this;
  }

  set_manifest_sha256(values: number[]): this {
    if (values.length !== 32) throw new Error("manifest_sha256 expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 8 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): BrainCreatedBody {
    const view = BrainCreatedBody.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build BrainCreatedBody");
    return view;
  }
}

__tnRegisterFootprint("BrainCreatedBody", (params) => BrainCreatedBody.__tnInvokeFootprint(params));
__tnRegisterValidate("BrainCreatedBody", (buffer, params) => BrainCreatedBody.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("BrainCreatedBody", (buffer) => { const result = BrainCreatedBody.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateBrainArgs ----- */

const __tn_ir_CreateBrainArgs = {
  typeName: "CreateBrainArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_size" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateBrainArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateBrainArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateBrainArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateBrainArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateBrainArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateBrainArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateBrainArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateBrainArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateBrainArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateBrainArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateBrainArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateBrainArgs.Params {
    return this.__tnParams;
  }

  withFieldContext(context: Record<string, number | bigint>): this {
    this.__tnFieldContext = context;
    return this;
  }

  private __tnResolveFieldRef(path: string): number {
    const getterName = `get_${path.replace(/[.]/g, '_')}`;
    const getter = (this as any)[getterName];
    if (typeof getter === "function") {
      const value = getter.call(this);
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateBrainArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreateBrainArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreateBrainArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreateBrainArgsBuilder {
    return new CreateBrainArgsBuilder();
  }

  static fromBuilder(builder: CreateBrainArgsBuilder): CreateBrainArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateBrainArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof", method: "proof", sizeField: "proof_size", paramKey: "proof_size", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateBrainArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 110) {
      return null;
    }
    const __tnParam_proof_proof_size = __tnToBigInt(view.getUint32(106, true));
    const __tnExtractedParams = CreateBrainArgs.Params.fromValues({
      proof_proof_size: __tnParam_proof_proof_size,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_account_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_account_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get account_index(): number {
    return this.get_account_index();
  }

  set account_index(value: number) {
    this.set_account_index(value);
  }

  get_seed(): number[] {
    const offset = 2;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_seed(value: number[]): void {
    const offset = 2;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get seed(): number[] {
    return this.get_seed();
  }

  set seed(value: number[]) {
    this.set_seed(value);
  }

  get_manifest_sha256(): number[] {
    const offset = 34;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_manifest_sha256(value: number[]): void {
    const offset = 34;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get manifest_sha256(): number[] {
    return this.get_manifest_sha256();
  }

  set manifest_sha256(value: number[]) {
    this.set_manifest_sha256(value);
  }

  get_authority(): number[] {
    const offset = 66;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_authority(value: number[]): void {
    const offset = 66;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get authority(): number[] {
    return this.get_authority();
  }

  set authority(value: number[]) {
    this.set_authority(value);
  }

  get_neuron_total(): number {
    const offset = 98;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_neuron_total(value: number): void {
    const offset = 98;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get neuron_total(): number {
    return this.get_neuron_total();
  }

  set neuron_total(value: number) {
    this.set_neuron_total(value);
  }

  get_synapse_total(): number {
    const offset = 102;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_synapse_total(value: number): void {
    const offset = 102;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get synapse_total(): number {
    return this.get_synapse_total();
  }

  set synapse_total(value: number) {
    this.set_synapse_total(value);
  }

  get_proof_size(): number {
    const offset = 106;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_size(value: number): void {
    const offset = 106;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_size(): number {
    return this.get_proof_size();
  }

  set proof_size(value: number) {
    this.set_proof_size(value);
  }

  get_proof_length(): number {
    return this.__tnResolveFieldRef("proof_size");
  }

  get_proof_at(index: number): number {
    const offset = 110;
    return this.view.getUint8(offset + index * 1);
  }

  get_proof(): number[] {
    const len = this.get_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_at(i));
    }
    return result;
  }

  set_proof_at(index: number, value: number): void {
    const offset = 110;
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof(value: number[]): void {
    const len = Math.min(this.get_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_at(i, value[i]);
    }
  }

  get proof(): number[] {
    return this.get_proof();
  }

  set proof(value: number[]) {
    this.set_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateBrainArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateBrainArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_proof_size: number | bigint): bigint {
    const params = CreateBrainArgs.Params.fromValues({
      proof_proof_size: proof_proof_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateBrainArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof.proof_size"] = params.proof_proof_size;
    return record;
  }

  static footprintIrFromParams(params: CreateBrainArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateBrainArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateBrainArgs');
    return __tnBigIntToNumber(irResult, 'CreateBrainArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_proof_size: number | bigint }): number {
    const params = CreateBrainArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateBrainArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateBrainArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateBrainArgs.Params } {
    if (!buffer || buffer.length === undefined) {
      return { ok: false, code: "tn.invalid_buffer" };
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      params = extracted.params;
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateBrainArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateBrainArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateBrainArgs.Params }): CreateBrainArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const derived = this.__tnExtractParams(view, buffer);
      if (!derived) return null;
      params = derived.params;
    }
    const validation = this.validate(buffer, { params });
    if (!validation.ok) {
      return null;
    }
    const cached = validation.params ?? params;
    const state = new CreateBrainArgs(buffer, cached);
    return state;
  }


}

export namespace CreateBrainArgs {
  export type Params = {
    /** ABI path: proof.proof_size */
    readonly proof_proof_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_proof_size: "proof.proof_size",
  } as const);

  export const Params = {
    fromValues(input: { proof_proof_size: number | bigint }): Params {
      return {
        proof_proof_size: __tnToBigInt(input.proof_proof_size),
      };
    },
    fromBuilder(source: { dynamicParams(): Params } | { params: Params } | Params): Params {
      if ((source as { dynamicParams?: () => Params }).dynamicParams) {
        return (source as { dynamicParams(): Params }).dynamicParams();
      }
      if ((source as { params?: Params }).params) {
        return (source as { params: Params }).params;
      }
      return source as Params;
    }
  };

  export function params(input: { proof_proof_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateBrainArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateBrainArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateBrainArgs.Params | null = null;
  private __tnFam_proof: Uint8Array | null = null;
  private __tnFam_proofCount: number | null = null;
  private __tnFamWriter_proof?: __TnFamWriterResult<CreateBrainArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(110);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_account_index(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_seed(values: number[]): this {
    if (values.length !== 32) throw new Error("seed expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 2 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_manifest_sha256(values: number[]): this {
    if (values.length !== 32) throw new Error("manifest_sha256 expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 34 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_authority(values: number[]): this {
    if (values.length !== 32) throw new Error("authority expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 66 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_neuron_total(value: number): this {
    this.view.setUint32(98, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_synapse_total(value: number): this {
    this.view.setUint32(102, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_proof_size(value: number): this {
    this.view.setUint32(106, value, true);
    this.__tnInvalidate();
    return this;
  }

  proof(): __TnFamWriterResult<CreateBrainArgsBuilder> {
    if (!this.__tnFamWriter_proof) {
      this.__tnFamWriter_proof = __tnCreateFamWriter(this, "proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof = bytes;
        this.__tnFam_proofCount = elementCount;
        this.set_proof_size(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateBrainArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateBrainArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateBrainArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateBrainArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateBrainArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateBrainArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateBrainArgs {
    return this.finish();
  }

  dynamicParams(): CreateBrainArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateBrainArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateBrainArgs.Params.fromValues({
      proof_proof_size: (() => { if (this.__tnFam_proofCount === null) throw new Error("CreateBrainArgsBuilder: field 'proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_proof_bytes = this.__tnFam_proof;
    if (!__tnLocal_proof_bytes) throw new Error("CreateBrainArgsBuilder: field 'proof' must be written before build");
    target.set(__tnLocal_proof_bytes, cursor);
    cursor += __tnLocal_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateBrainArgs.Params): void {
    const result = CreateBrainArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateBrainArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateBrainArgs", (params) => CreateBrainArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateBrainArgs", (buffer, params) => CreateBrainArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateBrainArgs", (buffer) => { const result = CreateBrainArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR CreateNeuronArgs ----- */

const __tn_ir_CreateNeuronArgs = {
  typeName: "CreateNeuronArgs",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "add", left: { op: "align", alignment: 2, node: { op: "const", value: 2n } }, right: { op: "align", alignment: 2, node: { op: "const", value: 2n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 32n } } }, right: { op: "align", alignment: 8, node: { op: "const", value: 8n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 4, node: { op: "const", value: 4n } } }, right: { op: "align", alignment: 1, node: { op: "mul", left: { op: "field", param: "proof.proof_size" }, right: { op: "const", value: 1n } } } } }
} as const;

export class CreateNeuronArgs {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private __tnParams: CreateNeuronArgs.Params;

  private constructor(private buffer: Uint8Array, params?: CreateNeuronArgs.Params, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = CreateNeuronArgs.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("CreateNeuronArgs: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: CreateNeuronArgs.Params, fieldContext?: Record<string, number | bigint> }): CreateNeuronArgs {
    if (!buffer || buffer.length === undefined) throw new Error("CreateNeuronArgs.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = CreateNeuronArgs.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("CreateNeuronArgs.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new CreateNeuronArgs(new Uint8Array(buffer), params, opts?.fieldContext);
    return instance;
  }

  dynamicParams(): CreateNeuronArgs.Params {
    return this.__tnParams;
  }

  withFieldContext(context: Record<string, number | bigint>): this {
    this.__tnFieldContext = context;
    return this;
  }

  private __tnResolveFieldRef(path: string): number {
    const getterName = `get_${path.replace(/[.]/g, '_')}`;
    const getter = (this as any)[getterName];
    if (typeof getter === "function") {
      const value = getter.call(this);
      return typeof value === "bigint" ? __tnBigIntToNumber(value, "CreateNeuronArgs::__tnResolveFieldRef") : value;
    }
    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {
      const contextValue = this.__tnFieldContext[path];
      return typeof contextValue === "bigint" ? __tnBigIntToNumber(contextValue, "CreateNeuronArgs::__tnResolveFieldRef") : contextValue;
    }
    throw new Error("CreateNeuronArgs: field reference '" + path + "' is not available; provide fieldContext when creating this view");
  }

  static builder(): CreateNeuronArgsBuilder {
    return new CreateNeuronArgsBuilder();
  }

  static fromBuilder(builder: CreateNeuronArgsBuilder): CreateNeuronArgs | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return CreateNeuronArgs.from_array(buffer, { params });
  }

  static readonly flexibleArrayWriters = Object.freeze([
    { field: "proof", method: "proof", sizeField: "proof_size", paramKey: "proof_size", elementSize: 1 },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: CreateNeuronArgs.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 56) {
      return null;
    }
    const __tnParam_proof_proof_size = __tnToBigInt(view.getUint32(52, true));
    const __tnExtractedParams = CreateNeuronArgs.Params.fromValues({
      proof_proof_size: __tnParam_proof_proof_size,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_brain_index(): number {
    const offset = 0;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_brain_index(value: number): void {
    const offset = 0;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get brain_index(): number {
    return this.get_brain_index();
  }

  set brain_index(value: number) {
    this.set_brain_index(value);
  }

  get_account_index(): number {
    const offset = 2;
    return this.view.getUint16(offset, true); /* little-endian */
  }

  set_account_index(value: number): void {
    const offset = 2;
    this.view.setUint16(offset, value, true); /* little-endian */
  }

  get account_index(): number {
    return this.get_account_index();
  }

  set account_index(value: number) {
    this.set_account_index(value);
  }

  get_index(): number {
    const offset = 4;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_index(value: number): void {
    const offset = 4;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get index(): number {
    return this.get_index();
  }

  set index(value: number) {
    this.set_index(value);
  }

  get_seed(): number[] {
    const offset = 8;
    const result: number[] = [];
    for (let i = 0; i < 32; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_seed(value: number[]): void {
    const offset = 8;
    if (value.length !== 32) {
      throw new Error('Array length must be 32');
    }
    for (let i = 0; i < 32; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get seed(): number[] {
    return this.get_seed();
  }

  set seed(value: number[]) {
    this.set_seed(value);
  }

  get_body_id(): bigint {
    const offset = 40;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_body_id(value: bigint): void {
    const offset = 40;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get body_id(): bigint {
    return this.get_body_id();
  }

  set body_id(value: bigint) {
    this.set_body_id(value);
  }

  get_cls(): number {
    const offset = 48;
    return this.view.getUint8(offset);
  }

  set_cls(value: number): void {
    const offset = 48;
    this.view.setUint8(offset, value);
  }

  get cls(): number {
    return this.get_cls();
  }

  set cls(value: number) {
    this.set_cls(value);
  }

  get_wedge(): number {
    const offset = 49;
    return this.view.getInt8(offset);
  }

  set_wedge(value: number): void {
    const offset = 49;
    this.view.setInt8(offset, value);
  }

  get wedge(): number {
    return this.get_wedge();
  }

  set wedge(value: number) {
    this.set_wedge(value);
  }

  get_sign(): number {
    const offset = 50;
    return this.view.getInt8(offset);
  }

  set_sign(value: number): void {
    const offset = 50;
    this.view.setInt8(offset, value);
  }

  get sign(): number {
    return this.get_sign();
  }

  set sign(value: number) {
    this.set_sign(value);
  }

  get_pad(): number {
    const offset = 51;
    return this.view.getUint8(offset);
  }

  set_pad(value: number): void {
    const offset = 51;
    this.view.setUint8(offset, value);
  }

  get pad(): number {
    return this.get_pad();
  }

  set pad(value: number) {
    this.set_pad(value);
  }

  get_proof_size(): number {
    const offset = 52;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_proof_size(value: number): void {
    const offset = 52;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get proof_size(): number {
    return this.get_proof_size();
  }

  set proof_size(value: number) {
    this.set_proof_size(value);
  }

  get_proof_length(): number {
    return this.__tnResolveFieldRef("proof_size");
  }

  get_proof_at(index: number): number {
    const offset = 56;
    return this.view.getUint8(offset + index * 1);
  }

  get_proof(): number[] {
    const len = this.get_proof_length();
    const result: number[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.get_proof_at(i));
    }
    return result;
  }

  set_proof_at(index: number, value: number): void {
    const offset = 56;
    this.view.setUint8((offset + index * 1), value);
  }

  set_proof(value: number[]): void {
    const len = Math.min(this.get_proof_length(), value.length);
    for (let i = 0; i < len; i++) {
      this.set_proof_at(i, value[i]);
    }
  }

  get proof(): number[] {
    return this.get_proof();
  }

  set proof(value: number[]) {
    this.set_proof(value);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_CreateNeuronArgs.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_CreateNeuronArgs, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(proof_proof_size: number | bigint): bigint {
    const params = CreateNeuronArgs.Params.fromValues({
      proof_proof_size: proof_proof_size,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: CreateNeuronArgs.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["proof.proof_size"] = params.proof_proof_size;
    return record;
  }

  static footprintIrFromParams(params: CreateNeuronArgs.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: CreateNeuronArgs.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for CreateNeuronArgs');
    return __tnBigIntToNumber(irResult, 'CreateNeuronArgs::footprintFromParams');
  }

  static footprintFromValues(input: { proof_proof_size: number | bigint }): number {
    const params = CreateNeuronArgs.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: CreateNeuronArgs.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: CreateNeuronArgs.Params }): { ok: boolean; code?: string; consumed?: number; params?: CreateNeuronArgs.Params } {
    if (!buffer || buffer.length === undefined) {
      return { ok: false, code: "tn.invalid_buffer" };
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      params = extracted.params;
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateNeuronArgs::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'CreateNeuronArgs::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: CreateNeuronArgs.Params }): CreateNeuronArgs | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const derived = this.__tnExtractParams(view, buffer);
      if (!derived) return null;
      params = derived.params;
    }
    const validation = this.validate(buffer, { params });
    if (!validation.ok) {
      return null;
    }
    const cached = validation.params ?? params;
    const state = new CreateNeuronArgs(buffer, cached);
    return state;
  }


}

export namespace CreateNeuronArgs {
  export type Params = {
    /** ABI path: proof.proof_size */
    readonly proof_proof_size: bigint;
  };

  export const ParamKeys = Object.freeze({
    proof_proof_size: "proof.proof_size",
  } as const);

  export const Params = {
    fromValues(input: { proof_proof_size: number | bigint }): Params {
      return {
        proof_proof_size: __tnToBigInt(input.proof_proof_size),
      };
    },
    fromBuilder(source: { dynamicParams(): Params } | { params: Params } | Params): Params {
      if ((source as { dynamicParams?: () => Params }).dynamicParams) {
        return (source as { dynamicParams(): Params }).dynamicParams();
      }
      if ((source as { params?: Params }).params) {
        return (source as { params: Params }).params;
      }
      return source as Params;
    }
  };

  export function params(input: { proof_proof_size: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class CreateNeuronArgsBuilder {
  private buffer: Uint8Array;
  private view: DataView;
  private __tnCachedParams: CreateNeuronArgs.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: CreateNeuronArgs.Params | null = null;
  private __tnFam_proof: Uint8Array | null = null;
  private __tnFam_proofCount: number | null = null;
  private __tnFamWriter_proof?: __TnFamWriterResult<CreateNeuronArgsBuilder>;

  constructor() {
    this.buffer = new Uint8Array(56);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  set_brain_index(value: number): this {
    this.view.setUint16(0, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_account_index(value: number): this {
    this.view.setUint16(2, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_index(value: number): this {
    this.view.setUint32(4, value, true);
    this.__tnInvalidate();
    return this;
  }

  set_seed(values: number[]): this {
    if (values.length !== 32) throw new Error("seed expects 32 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 8 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    this.__tnInvalidate();
    return this;
  }

  set_body_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(40, cast, true);
    this.__tnInvalidate();
    return this;
  }

  set_cls(value: number): this {
    this.view.setUint8(48, value);
    this.__tnInvalidate();
    return this;
  }

  set_wedge(value: number): this {
    this.view.setInt8(49, value);
    this.__tnInvalidate();
    return this;
  }

  set_sign(value: number): this {
    this.view.setInt8(50, value);
    this.__tnInvalidate();
    return this;
  }

  set_pad(value: number): this {
    this.view.setUint8(51, value);
    this.__tnInvalidate();
    return this;
  }

  set_proof_size(value: number): this {
    this.view.setUint32(52, value, true);
    this.__tnInvalidate();
    return this;
  }

  proof(): __TnFamWriterResult<CreateNeuronArgsBuilder> {
    if (!this.__tnFamWriter_proof) {
      this.__tnFamWriter_proof = __tnCreateFamWriter(this, "proof", (payload) => {
        const bytes = new Uint8Array(payload);
        const elementCount = bytes.length;
        this.__tnFam_proof = bytes;
        this.__tnFam_proofCount = elementCount;
        this.set_proof_size(elementCount);
        this.__tnInvalidate();
      });
    }
    return this.__tnFamWriter_proof!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateNeuronArgs.footprintFromParams(params);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    const size = CreateNeuronArgs.footprintFromParams(params);
    if (target.length - offset < size) throw new Error("CreateNeuronArgsBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): CreateNeuronArgs {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = CreateNeuronArgs.from_array(buffer, { params });
    if (!view) throw new Error("CreateNeuronArgsBuilder: failed to finalize view");
    return view;
  }

  finishView(): CreateNeuronArgs {
    return this.finish();
  }

  dynamicParams(): CreateNeuronArgs.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): CreateNeuronArgs.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = CreateNeuronArgs.Params.fromValues({
      proof_proof_size: (() => { if (this.__tnFam_proofCount === null) throw new Error("CreateNeuronArgsBuilder: field 'proof' must be written before computing params"); return __tnToBigInt(this.__tnFam_proofCount); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    target.set(this.buffer, 0);
    let cursor = this.buffer.length;
    const __tnLocal_proof_bytes = this.__tnFam_proof;
    if (!__tnLocal_proof_bytes) throw new Error("CreateNeuronArgsBuilder: field 'proof' must be written before build");
    target.set(__tnLocal_proof_bytes, cursor);
    cursor += __tnLocal_proof_bytes.length;
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: CreateNeuronArgs.Params): void {
    const result = CreateNeuronArgs.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ CreateNeuronArgs }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("CreateNeuronArgs", (params) => CreateNeuronArgs.__tnInvokeFootprint(params));
__tnRegisterValidate("CreateNeuronArgs", (buffer, params) => CreateNeuronArgs.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("CreateNeuronArgs", (buffer) => { const result = CreateNeuronArgs.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FlyBrainError ----- */

const __tn_ir_FlyBrainError = {
  typeName: "FlyBrainError",
  root: { op: "const", value: 8n }
} as const;

export class FlyBrainError {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): FlyBrainError {
    if (!buffer || buffer.length === undefined) throw new Error("FlyBrainError.__tnCreateView requires a Uint8Array");
    return new FlyBrainError(new Uint8Array(buffer));
  }

  static builder(): FlyBrainErrorBuilder {
    return new FlyBrainErrorBuilder();
  }

  static fromBuilder(builder: FlyBrainErrorBuilder): FlyBrainError | null {
    const buffer = builder.build();
    return FlyBrainError.from_array(buffer);
  }

  get_code(): bigint {
    const offset = 0;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_code(value: bigint): void {
    const offset = 0;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get code(): bigint {
    return this.get_code();
  }

  set code(value: bigint) {
    this.set_code(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FlyBrainError.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FlyBrainError, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FlyBrainError');
    }
    return __tnBigIntToNumber(irResult, 'FlyBrainError::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 8) return { ok: false, code: "tn.buffer_too_small", consumed: 8 };
    return { ok: true, consumed: 8 };
  }

  static new(code: bigint): FlyBrainError {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);

    let offset = 0;
    view.setBigUint64(0, code, true); /* code (little-endian) */

    return new FlyBrainError(buffer);
  }

  static from_array(buffer: Uint8Array): FlyBrainError | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new FlyBrainError(buffer);
  }

}

export class FlyBrainErrorBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(8);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_code(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(0, cast, true);
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): FlyBrainError {
    const view = FlyBrainError.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build FlyBrainError");
    return view;
  }
}

__tnRegisterFootprint("FlyBrainError", (params) => FlyBrainError.__tnInvokeFootprint(params));
__tnRegisterValidate("FlyBrainError", (buffer, params) => FlyBrainError.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FlyBrainError", (buffer) => { const result = FlyBrainError.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FlyBrainInstruction ----- */

const __tn_ir_FlyBrainInstruction = {
  typeName: "FlyBrainInstruction",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "align", alignment: 4, node: { op: "const", value: 4n } }, right: { op: "align", alignment: 1, node: { op: "field", param: "args.payload_size" } } } }
} as const;

export class FlyBrainInstruction_args_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): FlyBrainInstruction_args_Inner {
    return new FlyBrainInstruction_args_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asCreatebrain(): CreateBrainArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return CreateBrainArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asCreateneuron(): CreateNeuronArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return CreateNeuronArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asAddsynapse(): AddSynapseArgs | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return AddSynapseArgs.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class FlyBrainInstruction {
  private view: DataView;
  private static readonly __tnFieldOffset_args = 4;
  private __tnParams: FlyBrainInstruction.Params;

  private constructor(private buffer: Uint8Array, params?: FlyBrainInstruction.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = FlyBrainInstruction.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("FlyBrainInstruction: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: FlyBrainInstruction.Params, fieldContext?: Record<string, number | bigint> }): FlyBrainInstruction {
    if (!buffer || buffer.length === undefined) throw new Error("FlyBrainInstruction.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = FlyBrainInstruction.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("FlyBrainInstruction.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new FlyBrainInstruction(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): FlyBrainInstruction.Params {
    return this.__tnParams;
  }

  static builder(): FlyBrainInstructionBuilder {
    return new FlyBrainInstructionBuilder();
  }

  static fromBuilder(builder: FlyBrainInstructionBuilder): FlyBrainInstruction | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return FlyBrainInstruction.from_array(buffer, { params });
  }

  static readonly argsVariantDescriptors = Object.freeze([
    {
      name: "CreateBrain",
      tag: 0,
      payloadSize: null,
      payloadType: "FlyBrainInstruction::args::CreateBrain",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateBrainArgs),
    },
    {
      name: "CreateNeuron",
      tag: 1,
      payloadSize: null,
      payloadType: "FlyBrainInstruction::args::CreateNeuron",
      createPayloadBuilder: () => __tnMaybeCallBuilder(CreateNeuronArgs),
    },
    {
      name: "AddSynapse",
      tag: 2,
      payloadSize: 52,
      payloadType: "FlyBrainInstruction::args::AddSynapse",
      createPayloadBuilder: () => __tnMaybeCallBuilder(AddSynapseArgs),
    },
  ] as const);

  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null {
    const __tnLength = buffer.length;
    let __tnParamSeq_args_payload_size: bigint | null = null;
    let __tnFieldValue_instruction_type: number | null = null;
    let __tnCursorMutable = 0;
    if (__tnCursorMutable + 4 > __tnLength) return null;
    const __tnRead_instruction_type = view.getUint32(__tnCursorMutable, true);
    __tnFieldValue_instruction_type = __tnRead_instruction_type;
    __tnCursorMutable += 4;
    const __tnEnumTagValue_args = __tnFieldValue_instruction_type;
    if (__tnEnumTagValue_args === null) return null;
    let __tnEnumSize_args = 0;
    switch (Number(__tnEnumTagValue_args)) {
      case 0: break;
      case 1: break;
      case 2: break;
      default: return null;
    }
    if (__tnCursorMutable > __tnLength) return null;
    __tnEnumSize_args = __tnLength - __tnCursorMutable;
    __tnCursorMutable = __tnLength;
    __tnParamSeq_args_payload_size = __tnToBigInt(__tnEnumSize_args);
    const params: Record<string, bigint> = Object.create(null);
    if (__tnParamSeq_args_payload_size === null) return null;
    params["args_payload_size"] = __tnParamSeq_args_payload_size as bigint;
    return { params, offsets: null, derived: null };
  }

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: FlyBrainInstruction.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 4) {
      return null;
    }
    const __tnParam_args_instruction_type = __tnToBigInt(view.getUint32(0, true));
    const __tnLayout = FlyBrainInstruction.__tnComputeSequentialLayout(view, buffer);
    if (!__tnLayout || !__tnLayout.params) return null;
    const __tnSeqParams = __tnLayout.params;
    const __tnParamSeq_args_payload_size = __tnSeqParams["args_payload_size"];
    if (__tnParamSeq_args_payload_size === undefined) return null;
    const __tnExtractedParams = FlyBrainInstruction.Params.fromValues({
      args_payload_size: __tnParamSeq_args_payload_size as bigint,
      args_instruction_type: __tnParam_args_instruction_type,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_instruction_type(): number {
    const offset = 0;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_instruction_type(value: number): void {
    const offset = 0;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get instruction_type(): number {
    return this.get_instruction_type();
  }

  set instruction_type(value: number) {
    this.set_instruction_type(value);
  }

  argsVariant(): typeof FlyBrainInstruction.argsVariantDescriptors[number] | null {
    const tag = this.view.getUint8(0);
    return FlyBrainInstruction.argsVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  args(): FlyBrainInstruction_args_Inner {
    const descriptor = this.argsVariant();
    if (!descriptor) throw new Error("FlyBrainInstruction: unknown args variant");
    const offset = FlyBrainInstruction.__tnFieldOffset_args;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("FlyBrainInstruction: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return FlyBrainInstruction_args_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FlyBrainInstruction.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FlyBrainInstruction, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(args_payload_size: number | bigint, args_instruction_type: number | bigint): bigint {
    const params = FlyBrainInstruction.Params.fromValues({
      args_payload_size: args_payload_size,
      args_instruction_type: args_instruction_type,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: FlyBrainInstruction.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["args.payload_size"] = params.args_payload_size;
    record["args.instruction_type"] = params.args_instruction_type;
    return record;
  }

  static footprintIrFromParams(params: FlyBrainInstruction.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: FlyBrainInstruction.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FlyBrainInstruction');
    return __tnBigIntToNumber(irResult, 'FlyBrainInstruction::footprintFromParams');
  }

  static footprintFromValues(input: { args_payload_size: number | bigint, args_instruction_type: number | bigint }): number {
    const params = FlyBrainInstruction.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: FlyBrainInstruction.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: FlyBrainInstruction.Params }): { ok: boolean; code?: string; consumed?: number; params?: FlyBrainInstruction.Params } {
    if (!buffer || buffer.length === undefined) {
      return { ok: false, code: "tn.invalid_buffer" };
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      params = extracted.params;
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'FlyBrainInstruction::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'FlyBrainInstruction::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: FlyBrainInstruction.Params }): FlyBrainInstruction | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const derived = this.__tnExtractParams(view, buffer);
      if (!derived) return null;
      params = derived.params;
    }
    const validation = this.validate(buffer, { params });
    if (!validation.ok) {
      return null;
    }
    const cached = validation.params ?? params;
    const state = new FlyBrainInstruction(buffer, cached);
    return state;
  }


}

export namespace FlyBrainInstruction {
  export type Params = {
    /** ABI path: args.payload_size */
    readonly args_payload_size: bigint;
    /** ABI path: args.instruction_type */
    readonly args_instruction_type: bigint;
  };

  export const ParamKeys = Object.freeze({
    args_payload_size: "args.payload_size",
    args_instruction_type: "args.instruction_type",
  } as const);

  export const Params = {
    fromValues(input: { args_payload_size: number | bigint, args_instruction_type: number | bigint }): Params {
      return {
        args_payload_size: __tnToBigInt(input.args_payload_size),
        args_instruction_type: __tnToBigInt(input.args_instruction_type),
      };
    },
    fromBuilder(source: { dynamicParams(): Params } | { params: Params } | Params): Params {
      if ((source as { dynamicParams?: () => Params }).dynamicParams) {
        return (source as { dynamicParams(): Params }).dynamicParams();
      }
      if ((source as { params?: Params }).params) {
        return (source as { params: Params }).params;
      }
      return source as Params;
    }
  };

  export function params(input: { args_payload_size: number | bigint, args_instruction_type: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class FlyBrainInstructionBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_instruction_type: number | null = null;
  private __tnPayload_args: { descriptor: typeof FlyBrainInstruction.argsVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: FlyBrainInstruction.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: FlyBrainInstruction.Params | null = null;
  private __tnVariantSelector_args?: __TnVariantSelectorResult<FlyBrainInstructionBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(4);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_instruction_type(value: number): void {
    this.__tnField_instruction_type = value;
    this.__tnInvalidate();
  }

  set_instruction_type(value: number): this {
    this.__tnAssign_instruction_type(value);
    return this;
  }

  args(): __TnVariantSelectorResult<FlyBrainInstructionBuilder> {
    if (!this.__tnVariantSelector_args) {
      this.__tnVariantSelector_args = __tnCreateVariantSelector(this, FlyBrainInstruction.argsVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_args = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_instruction_type(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_args!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_instruction_type === null) throw new Error("FlyBrainInstructionBuilder: field 'instruction_type' must be set before build");
    if (!this.__tnPayload_args) throw new Error("FlyBrainInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_args.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = FlyBrainInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_instruction_type === null) throw new Error("FlyBrainInstructionBuilder: field 'instruction_type' must be set before build");
    if (!this.__tnPayload_args) throw new Error("FlyBrainInstructionBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_args.bytes.length;
    const requiredSize = 4 + payloadLength;
    const footprintSize = FlyBrainInstruction.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("FlyBrainInstructionBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): FlyBrainInstruction {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = FlyBrainInstruction.from_array(buffer, { params });
    if (!view) throw new Error("FlyBrainInstructionBuilder: failed to finalize view");
    return view;
  }

  finishView(): FlyBrainInstruction {
    return this.finish();
  }

  dynamicParams(): FlyBrainInstruction.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): FlyBrainInstruction.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = FlyBrainInstruction.Params.fromValues({
      args_payload_size: (() => { if (!this.__tnPayload_args) throw new Error("FlyBrainInstructionBuilder: payload 'args' must be selected before build"); return __tnToBigInt(this.__tnPayload_args.bytes.length); })(),
      args_instruction_type: (() => { if (this.__tnField_instruction_type === null) throw new Error("FlyBrainInstructionBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_instruction_type); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_instruction_type === null) throw new Error("FlyBrainInstructionBuilder: field 'instruction_type' must be set before build");
    if (!this.__tnPayload_args) throw new Error("FlyBrainInstructionBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint32(0, this.__tnField_instruction_type, true);
    target.set(this.__tnPayload_args.bytes, 4);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: FlyBrainInstruction.Params): void {
    const result = FlyBrainInstruction.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ FlyBrainInstruction }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("FlyBrainInstruction", (params) => FlyBrainInstruction.__tnInvokeFootprint(params));
__tnRegisterValidate("FlyBrainInstruction", (buffer, params) => FlyBrainInstruction.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FlyBrainInstruction", (buffer) => { const result = FlyBrainInstruction.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR NeuronAccountBody ----- */

const __tn_ir_NeuronAccountBody = {
  typeName: "NeuronAccountBody",
  root: { op: "const", value: 22n }
} as const;

export class NeuronAccountBody {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): NeuronAccountBody {
    if (!buffer || buffer.length === undefined) throw new Error("NeuronAccountBody.__tnCreateView requires a Uint8Array");
    return new NeuronAccountBody(new Uint8Array(buffer));
  }

  static builder(): NeuronAccountBodyBuilder {
    return new NeuronAccountBodyBuilder();
  }

  static fromBuilder(builder: NeuronAccountBodyBuilder): NeuronAccountBody | null {
    const buffer = builder.build();
    return NeuronAccountBody.from_array(buffer);
  }

  get_cls(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_cls(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get cls(): number {
    return this.get_cls();
  }

  set cls(value: number) {
    this.set_cls(value);
  }

  get_wedge(): number {
    const offset = 1;
    return this.view.getInt8(offset);
  }

  set_wedge(value: number): void {
    const offset = 1;
    this.view.setInt8(offset, value);
  }

  get wedge(): number {
    return this.get_wedge();
  }

  set wedge(value: number) {
    this.set_wedge(value);
  }

  get_sign(): number {
    const offset = 2;
    return this.view.getInt8(offset);
  }

  set_sign(value: number): void {
    const offset = 2;
    this.view.setInt8(offset, value);
  }

  get sign(): number {
    return this.get_sign();
  }

  set sign(value: number) {
    this.set_sign(value);
  }

  get_pad(): number[] {
    const offset = 3;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_pad(value: number[]): void {
    const offset = 3;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get pad(): number[] {
    return this.get_pad();
  }

  set pad(value: number[]) {
    this.set_pad(value);
  }

  get_out_count(): number {
    const offset = 6;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_out_count(value: number): void {
    const offset = 6;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get out_count(): number {
    return this.get_out_count();
  }

  set out_count(value: number) {
    this.set_out_count(value);
  }

  get_in_count(): number {
    const offset = 10;
    return this.view.getUint32(offset, true); /* little-endian */
  }

  set_in_count(value: number): void {
    const offset = 10;
    this.view.setUint32(offset, value, true); /* little-endian */
  }

  get in_count(): number {
    return this.get_in_count();
  }

  set in_count(value: number) {
    this.set_in_count(value);
  }

  get_body_id(): bigint {
    const offset = 14;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_body_id(value: bigint): void {
    const offset = 14;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get body_id(): bigint {
    return this.get_body_id();
  }

  set body_id(value: bigint) {
    this.set_body_id(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_NeuronAccountBody.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_NeuronAccountBody, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for NeuronAccountBody');
    }
    return __tnBigIntToNumber(irResult, 'NeuronAccountBody::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 22) return { ok: false, code: "tn.buffer_too_small", consumed: 22 };
    return { ok: true, consumed: 22 };
  }

  static from_array(buffer: Uint8Array): NeuronAccountBody | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new NeuronAccountBody(buffer);
  }

}

export class NeuronAccountBodyBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(22);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_cls(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_wedge(value: number): this {
    this.view.setInt8(1, value);
    return this;
  }

  set_sign(value: number): this {
    this.view.setInt8(2, value);
    return this;
  }

  set_pad(values: number[]): this {
    if (values.length !== 3) throw new Error("pad expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 3 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_out_count(value: number): this {
    this.view.setUint32(6, value, true);
    return this;
  }

  set_in_count(value: number): this {
    this.view.setUint32(10, value, true);
    return this;
  }

  set_body_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(14, cast, true);
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): NeuronAccountBody {
    const view = NeuronAccountBody.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build NeuronAccountBody");
    return view;
  }
}

__tnRegisterFootprint("NeuronAccountBody", (params) => NeuronAccountBody.__tnInvokeFootprint(params));
__tnRegisterValidate("NeuronAccountBody", (buffer, params) => NeuronAccountBody.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("NeuronAccountBody", (buffer) => { const result = NeuronAccountBody.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR NeuronCreatedBody ----- */

const __tn_ir_NeuronCreatedBody = {
  typeName: "NeuronCreatedBody",
  root: { op: "const", value: 14n }
} as const;

export class NeuronCreatedBody {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): NeuronCreatedBody {
    if (!buffer || buffer.length === undefined) throw new Error("NeuronCreatedBody.__tnCreateView requires a Uint8Array");
    return new NeuronCreatedBody(new Uint8Array(buffer));
  }

  static builder(): NeuronCreatedBodyBuilder {
    return new NeuronCreatedBodyBuilder();
  }

  static fromBuilder(builder: NeuronCreatedBodyBuilder): NeuronCreatedBody | null {
    const buffer = builder.build();
    return NeuronCreatedBody.from_array(buffer);
  }

  get_cls(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_cls(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get cls(): number {
    return this.get_cls();
  }

  set cls(value: number) {
    this.set_cls(value);
  }

  get_wedge(): number {
    const offset = 1;
    return this.view.getInt8(offset);
  }

  set_wedge(value: number): void {
    const offset = 1;
    this.view.setInt8(offset, value);
  }

  get wedge(): number {
    return this.get_wedge();
  }

  set wedge(value: number) {
    this.set_wedge(value);
  }

  get_sign(): number {
    const offset = 2;
    return this.view.getInt8(offset);
  }

  set_sign(value: number): void {
    const offset = 2;
    this.view.setInt8(offset, value);
  }

  get sign(): number {
    return this.get_sign();
  }

  set sign(value: number) {
    this.set_sign(value);
  }

  get_pad(): number[] {
    const offset = 3;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_pad(value: number[]): void {
    const offset = 3;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get pad(): number[] {
    return this.get_pad();
  }

  set pad(value: number[]) {
    this.set_pad(value);
  }

  get_body_id(): bigint {
    const offset = 6;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_body_id(value: bigint): void {
    const offset = 6;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get body_id(): bigint {
    return this.get_body_id();
  }

  set body_id(value: bigint) {
    this.set_body_id(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_NeuronCreatedBody.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_NeuronCreatedBody, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for NeuronCreatedBody');
    }
    return __tnBigIntToNumber(irResult, 'NeuronCreatedBody::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 14) return { ok: false, code: "tn.buffer_too_small", consumed: 14 };
    return { ok: true, consumed: 14 };
  }

  static from_array(buffer: Uint8Array): NeuronCreatedBody | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new NeuronCreatedBody(buffer);
  }

}

export class NeuronCreatedBodyBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(14);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_cls(value: number): this {
    this.view.setUint8(0, value);
    return this;
  }

  set_wedge(value: number): this {
    this.view.setInt8(1, value);
    return this;
  }

  set_sign(value: number): this {
    this.view.setInt8(2, value);
    return this;
  }

  set_pad(values: number[]): this {
    if (values.length !== 3) throw new Error("pad expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 3 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_body_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): NeuronCreatedBody {
    const view = NeuronCreatedBody.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build NeuronCreatedBody");
    return view;
  }
}

__tnRegisterFootprint("NeuronCreatedBody", (params) => NeuronCreatedBody.__tnInvokeFootprint(params));
__tnRegisterValidate("NeuronCreatedBody", (buffer, params) => NeuronCreatedBody.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("NeuronCreatedBody", (buffer) => { const result = NeuronCreatedBody.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR SynapseAddedBody ----- */

const __tn_ir_SynapseAddedBody = {
  typeName: "SynapseAddedBody",
  root: { op: "const", value: 46n }
} as const;

export class SynapseAddedBody {
  private view: DataView;

  private constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { fieldContext?: Record<string, number | bigint> }): SynapseAddedBody {
    if (!buffer || buffer.length === undefined) throw new Error("SynapseAddedBody.__tnCreateView requires a Uint8Array");
    return new SynapseAddedBody(new Uint8Array(buffer));
  }

  static builder(): SynapseAddedBodyBuilder {
    return new SynapseAddedBodyBuilder();
  }

  static fromBuilder(builder: SynapseAddedBodyBuilder): SynapseAddedBody | null {
    const buffer = builder.build();
    return SynapseAddedBody.from_array(buffer);
  }

  get_pad(): number[] {
    const offset = 0;
    const result: number[] = [];
    for (let i = 0; i < 6; i++) {
      result.push(this.view.getUint8((offset + i * 1)));
    }
    return result;
  }

  set_pad(value: number[]): void {
    const offset = 0;
    if (value.length !== 6) {
      throw new Error('Array length must be 6');
    }
    for (let i = 0; i < 6; i++) {
      this.view.setUint8((offset + i * 1), value[i]);
    }
  }

  get pad(): number[] {
    return this.get_pad();
  }

  set pad(value: number[]) {
    this.set_pad(value);
  }

  get_pre_body_id(): bigint {
    const offset = 6;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_pre_body_id(value: bigint): void {
    const offset = 6;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get pre_body_id(): bigint {
    return this.get_pre_body_id();
  }

  set pre_body_id(value: bigint) {
    this.set_pre_body_id(value);
  }

  get_post_body_id(): bigint {
    const offset = 14;
    return this.view.getBigUint64(offset, true); /* little-endian */
  }

  set_post_body_id(value: bigint): void {
    const offset = 14;
    this.view.setBigUint64(offset, value, true); /* little-endian */
  }

  get post_body_id(): bigint {
    return this.get_post_body_id();
  }

  set post_body_id(value: bigint) {
    this.set_post_body_id(value);
  }

  get_pre_xyz(): number[] {
    const offset = 22;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getInt32((offset + i * 4), true));
    }
    return result;
  }

  set_pre_xyz(value: number[]): void {
    const offset = 22;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setInt32((offset + i * 4), value[i], true);
    }
  }

  get pre_xyz(): number[] {
    return this.get_pre_xyz();
  }

  set pre_xyz(value: number[]) {
    this.set_pre_xyz(value);
  }

  get_post_xyz(): number[] {
    const offset = 34;
    const result: number[] = [];
    for (let i = 0; i < 3; i++) {
      result.push(this.view.getInt32((offset + i * 4), true));
    }
    return result;
  }

  set_post_xyz(value: number[]): void {
    const offset = 34;
    if (value.length !== 3) {
      throw new Error('Array length must be 3');
    }
    for (let i = 0; i < 3; i++) {
      this.view.setInt32((offset + i * 4), value[i], true);
    }
  }

  get post_xyz(): number[] {
    return this.get_post_xyz();
  }

  set post_xyz(value: number[]) {
    this.set_post_xyz(value);
  }

  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_SynapseAddedBody.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_SynapseAddedBody, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(): bigint {
    return this.__tnFootprintInternal(Object.create(null));
  }

  static footprint(): number {
    const irResult = this.footprintIr();
      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) {
      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for SynapseAddedBody');
    }
    return __tnBigIntToNumber(irResult, 'SynapseAddedBody::footprint');
  }

  static validate(buffer: Uint8Array, _opts?: { params?: never }): { ok: boolean; code?: string; consumed?: number } {
    if (buffer.length < 46) return { ok: false, code: "tn.buffer_too_small", consumed: 46 };
    return { ok: true, consumed: 46 };
  }

  static from_array(buffer: Uint8Array): SynapseAddedBody | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const validation = this.validate(buffer);
    if (!validation.ok) {
      return null;
    }
    return new SynapseAddedBody(buffer);
  }

}

export class SynapseAddedBodyBuilder {
  private buffer: Uint8Array;
  private view: DataView;

  constructor() {
    this.buffer = new Uint8Array(46);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  set_pad(values: number[]): this {
    if (values.length !== 6) throw new Error("pad expects 6 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 0 + i * 1;
      this.view.setUint8(byteOffset, values[i]);
    }
    return this;
  }

  set_pre_body_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(6, cast, true);
    return this;
  }

  set_post_body_id(value: bigint): this {
    const cast = __tnToBigInt(value);
    this.view.setBigUint64(14, cast, true);
    return this;
  }

  set_pre_xyz(values: number[]): this {
    if (values.length !== 3) throw new Error("pre_xyz expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 22 + i * 4;
      this.view.setInt32(byteOffset, values[i], true);
    }
    return this;
  }

  set_post_xyz(values: number[]): this {
    if (values.length !== 3) throw new Error("post_xyz expects 3 elements");
    for (let i = 0; i < values.length; i++) {
      const byteOffset = 34 + i * 4;
      this.view.setInt32(byteOffset, values[i], true);
    }
    return this;
  }

  build(): Uint8Array {
    return this.buffer.slice();
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    if (target.length - offset < this.buffer.length) throw new Error("target buffer too small");
    target.set(this.buffer, offset);
    return target;
  }

  finish(): SynapseAddedBody {
    const view = SynapseAddedBody.from_array(this.buffer.slice());
    if (!view) throw new Error("failed to build SynapseAddedBody");
    return view;
  }
}

__tnRegisterFootprint("SynapseAddedBody", (params) => SynapseAddedBody.__tnInvokeFootprint(params));
__tnRegisterValidate("SynapseAddedBody", (buffer, params) => SynapseAddedBody.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("SynapseAddedBody", (buffer) => { const result = SynapseAddedBody.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FlyBrainAccount ----- */

const __tn_ir_FlyBrainAccount = {
  typeName: "FlyBrainAccount",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "FlyBrainAccount::body.kind", cases: [{ value: 0, node: { op: "align", alignment: 1, node: { op: "const", value: 82n } } }, { value: 1, node: { op: "align", alignment: 1, node: { op: "const", value: 22n } } }] } } } }
} as const;

export class FlyBrainAccount_body_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): FlyBrainAccount_body_Inner {
    return new FlyBrainAccount_body_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asBrain(): BrainAccountBody | null {
    if (!this.descriptor || this.descriptor.tag !== 0) return null;
    return BrainAccountBody.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asNeuron(): NeuronAccountBody | null {
    if (!this.descriptor || this.descriptor.tag !== 1) return null;
    return NeuronAccountBody.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class FlyBrainAccount {
  private view: DataView;
  private static readonly __tnFieldOffset_body = 2;
  private __tnParams: FlyBrainAccount.Params;

  private constructor(private buffer: Uint8Array, params?: FlyBrainAccount.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = FlyBrainAccount.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("FlyBrainAccount: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: FlyBrainAccount.Params, fieldContext?: Record<string, number | bigint> }): FlyBrainAccount {
    if (!buffer || buffer.length === undefined) throw new Error("FlyBrainAccount.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = FlyBrainAccount.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("FlyBrainAccount.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new FlyBrainAccount(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): FlyBrainAccount.Params {
    return this.__tnParams;
  }

  static builder(): FlyBrainAccountBuilder {
    return new FlyBrainAccountBuilder();
  }

  static fromBuilder(builder: FlyBrainAccountBuilder): FlyBrainAccount | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return FlyBrainAccount.from_array(buffer, { params });
  }

  static readonly bodyVariantDescriptors = Object.freeze([
    {
      name: "Brain",
      tag: 0,
      payloadSize: 82,
      payloadType: "FlyBrainAccount::body::Brain",
      createPayloadBuilder: () => __tnMaybeCallBuilder(BrainAccountBody),
    },
    {
      name: "Neuron",
      tag: 1,
      payloadSize: 22,
      payloadType: "FlyBrainAccount::body::Neuron",
      createPayloadBuilder: () => __tnMaybeCallBuilder(NeuronAccountBody),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: FlyBrainAccount.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 2) {
      return null;
    }
    const __tnParam_body_kind = __tnToBigInt(view.getUint8(1));
    const __tnExtractedParams = FlyBrainAccount.Params.fromValues({
      body_kind: __tnParam_body_kind,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_version(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_version(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get version(): number {
    return this.get_version();
  }

  set version(value: number) {
    this.set_version(value);
  }

  get_kind(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_kind(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get kind(): number {
    return this.get_kind();
  }

  set kind(value: number) {
    this.set_kind(value);
  }

  bodyVariant(): typeof FlyBrainAccount.bodyVariantDescriptors[number] | null {
    const tag = this.view.getUint8(1);
    return FlyBrainAccount.bodyVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  body(): FlyBrainAccount_body_Inner {
    const descriptor = this.bodyVariant();
    if (!descriptor) throw new Error("FlyBrainAccount: unknown body variant");
    const offset = FlyBrainAccount.__tnFieldOffset_body;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("FlyBrainAccount: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return FlyBrainAccount_body_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FlyBrainAccount.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FlyBrainAccount, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(body_kind: number | bigint): bigint {
    const params = FlyBrainAccount.Params.fromValues({
      body_kind: body_kind,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: FlyBrainAccount.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["body.kind"] = params.body_kind;
    record["FlyBrainAccount::body.kind"] = params.body_kind;
    return record;
  }

  static footprintIrFromParams(params: FlyBrainAccount.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: FlyBrainAccount.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FlyBrainAccount');
    return __tnBigIntToNumber(irResult, 'FlyBrainAccount::footprintFromParams');
  }

  static footprintFromValues(input: { body_kind: number | bigint }): number {
    const params = FlyBrainAccount.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: FlyBrainAccount.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: FlyBrainAccount.Params }): { ok: boolean; code?: string; consumed?: number; params?: FlyBrainAccount.Params } {
    if (!buffer || buffer.length === undefined) {
      return { ok: false, code: "tn.invalid_buffer" };
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      params = extracted.params;
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'FlyBrainAccount::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'FlyBrainAccount::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: FlyBrainAccount.Params }): FlyBrainAccount | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const derived = this.__tnExtractParams(view, buffer);
      if (!derived) return null;
      params = derived.params;
    }
    const validation = this.validate(buffer, { params });
    if (!validation.ok) {
      return null;
    }
    const cached = validation.params ?? params;
    const state = new FlyBrainAccount(buffer, cached);
    return state;
  }


}

export namespace FlyBrainAccount {
  export type Params = {
    /** ABI path: body.kind */
    readonly body_kind: bigint;
  };

  export const ParamKeys = Object.freeze({
    body_kind: "body.kind",
  } as const);

  export const Params = {
    fromValues(input: { body_kind: number | bigint }): Params {
      return {
        body_kind: __tnToBigInt(input.body_kind),
      };
    },
    fromBuilder(source: { dynamicParams(): Params } | { params: Params } | Params): Params {
      if ((source as { dynamicParams?: () => Params }).dynamicParams) {
        return (source as { dynamicParams(): Params }).dynamicParams();
      }
      if ((source as { params?: Params }).params) {
        return (source as { params: Params }).params;
      }
      return source as Params;
    }
  };

  export function params(input: { body_kind: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class FlyBrainAccountBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_kind: number | null = null;
  private __tnPayload_body: { descriptor: typeof FlyBrainAccount.bodyVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: FlyBrainAccount.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: FlyBrainAccount.Params | null = null;
  private __tnVariantSelector_body?: __TnVariantSelectorResult<FlyBrainAccountBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(2);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  set_version(value: number): this {
    this.__tnPrefixView.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_kind(value: number): void {
    this.__tnField_kind = value;
    this.__tnInvalidate();
  }

  set_kind(value: number): this {
    this.__tnAssign_kind(value);
    return this;
  }

  body(): __TnVariantSelectorResult<FlyBrainAccountBuilder> {
    if (!this.__tnVariantSelector_body) {
      this.__tnVariantSelector_body = __tnCreateVariantSelector(this, FlyBrainAccount.bodyVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_body = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_kind(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_body!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_kind === null) throw new Error("FlyBrainAccountBuilder: field 'kind' must be set before build");
    if (!this.__tnPayload_body) throw new Error("FlyBrainAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_body.bytes.length;
    const requiredSize = 2 + payloadLength;
    const footprintSize = FlyBrainAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_kind === null) throw new Error("FlyBrainAccountBuilder: field 'kind' must be set before build");
    if (!this.__tnPayload_body) throw new Error("FlyBrainAccountBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_body.bytes.length;
    const requiredSize = 2 + payloadLength;
    const footprintSize = FlyBrainAccount.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("FlyBrainAccountBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): FlyBrainAccount {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = FlyBrainAccount.from_array(buffer, { params });
    if (!view) throw new Error("FlyBrainAccountBuilder: failed to finalize view");
    return view;
  }

  finishView(): FlyBrainAccount {
    return this.finish();
  }

  dynamicParams(): FlyBrainAccount.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): FlyBrainAccount.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = FlyBrainAccount.Params.fromValues({
      body_kind: (() => { if (this.__tnField_kind === null) throw new Error("FlyBrainAccountBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_kind); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_kind === null) throw new Error("FlyBrainAccountBuilder: field 'kind' must be set before build");
    if (!this.__tnPayload_body) throw new Error("FlyBrainAccountBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(1, this.__tnField_kind);
    target.set(this.__tnPayload_body.bytes, 2);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: FlyBrainAccount.Params): void {
    const result = FlyBrainAccount.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ FlyBrainAccount }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("FlyBrainAccount", (params) => FlyBrainAccount.__tnInvokeFootprint(params));
__tnRegisterValidate("FlyBrainAccount", (buffer, params) => FlyBrainAccount.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FlyBrainAccount", (buffer) => { const result = FlyBrainAccount.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });

/* ----- TYPE DEFINITION FOR FlyBrainEvent ----- */

const __tn_ir_FlyBrainEvent = {
  typeName: "FlyBrainEvent",
  root: { op: "align", alignment: 1, node: { op: "add", left: { op: "add", left: { op: "align", alignment: 1, node: { op: "const", value: 1n } }, right: { op: "align", alignment: 1, node: { op: "const", value: 1n } } }, right: { op: "align", alignment: 1, node: { op: "switch", tag: "FlyBrainEvent::body.kind", cases: [{ value: 2, node: { op: "align", alignment: 1, node: { op: "const", value: 40n } } }, { value: 3, node: { op: "align", alignment: 1, node: { op: "const", value: 14n } } }, { value: 4, node: { op: "align", alignment: 1, node: { op: "const", value: 46n } } }] } } } }
} as const;

export class FlyBrainEvent_body_Inner {
  private view: DataView;
  private __tnFieldContext: Record<string, number | bigint> | null = null;
  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.__tnFieldContext = fieldContext ?? null;
  }

  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): FlyBrainEvent_body_Inner {
    return new FlyBrainEvent_body_Inner(new Uint8Array(payload), descriptor, fieldContext);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  variant(): __TnVariantDescriptor | null {
    return this.descriptor;
  }

  asBraincreated(): BrainCreatedBody | null {
    if (!this.descriptor || this.descriptor.tag !== 2) return null;
    return BrainCreatedBody.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asNeuroncreated(): NeuronCreatedBody | null {
    if (!this.descriptor || this.descriptor.tag !== 3) return null;
    return NeuronCreatedBody.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

  asSynapseadded(): SynapseAddedBody | null {
    if (!this.descriptor || this.descriptor.tag !== 4) return null;
    return SynapseAddedBody.__tnCreateView(new Uint8Array(this.buffer), { fieldContext: this.__tnFieldContext ?? undefined });
  }

}

export class FlyBrainEvent {
  private view: DataView;
  private static readonly __tnFieldOffset_body = 2;
  private __tnParams: FlyBrainEvent.Params;

  private constructor(private buffer: Uint8Array, params?: FlyBrainEvent.Params) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (params) {
      this.__tnParams = params;
    } else {
      const derived = FlyBrainEvent.__tnExtractParams(this.view, buffer);
      if (!derived) {
        throw new Error("FlyBrainEvent: failed to derive dynamic parameters");
      }
      this.__tnParams = derived.params;
    }
  }

  static __tnCreateView(buffer: Uint8Array, opts?: { params?: FlyBrainEvent.Params, fieldContext?: Record<string, number | bigint> }): FlyBrainEvent {
    if (!buffer || buffer.length === undefined) throw new Error("FlyBrainEvent.__tnCreateView requires a Uint8Array");
    let params = opts?.params ?? null;
    if (!params) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const derived = FlyBrainEvent.__tnExtractParams(view, buffer);
      if (!derived) throw new Error("FlyBrainEvent.__tnCreateView: failed to derive params");
      params = derived.params;
    }
    const instance = new FlyBrainEvent(new Uint8Array(buffer), params);
    return instance;
  }

  dynamicParams(): FlyBrainEvent.Params {
    return this.__tnParams;
  }

  static builder(): FlyBrainEventBuilder {
    return new FlyBrainEventBuilder();
  }

  static fromBuilder(builder: FlyBrainEventBuilder): FlyBrainEvent | null {
    const buffer = builder.build();
    const params = builder.dynamicParams();
    return FlyBrainEvent.from_array(buffer, { params });
  }

  static readonly bodyVariantDescriptors = Object.freeze([
    {
      name: "BrainCreated",
      tag: 2,
      payloadSize: 40,
      payloadType: "FlyBrainEvent::body::BrainCreated",
      createPayloadBuilder: () => __tnMaybeCallBuilder(BrainCreatedBody),
    },
    {
      name: "NeuronCreated",
      tag: 3,
      payloadSize: 14,
      payloadType: "FlyBrainEvent::body::NeuronCreated",
      createPayloadBuilder: () => __tnMaybeCallBuilder(NeuronCreatedBody),
    },
    {
      name: "SynapseAdded",
      tag: 4,
      payloadSize: 46,
      payloadType: "FlyBrainEvent::body::SynapseAdded",
      createPayloadBuilder: () => __tnMaybeCallBuilder(SynapseAddedBody),
    },
  ] as const);

  private static __tnExtractParams(view: DataView, buffer: Uint8Array): { params: FlyBrainEvent.Params; derived: Record<string, bigint> | null } | null {
    if (buffer.length < 2) {
      return null;
    }
    const __tnParam_body_kind = __tnToBigInt(view.getUint8(1));
    const __tnExtractedParams = FlyBrainEvent.Params.fromValues({
      body_kind: __tnParam_body_kind,
    });
    return { params: __tnExtractedParams, derived: null };
  }

  get_version(): number {
    const offset = 0;
    return this.view.getUint8(offset);
  }

  set_version(value: number): void {
    const offset = 0;
    this.view.setUint8(offset, value);
  }

  get version(): number {
    return this.get_version();
  }

  set version(value: number) {
    this.set_version(value);
  }

  get_kind(): number {
    const offset = 1;
    return this.view.getUint8(offset);
  }

  set_kind(value: number): void {
    const offset = 1;
    this.view.setUint8(offset, value);
  }

  get kind(): number {
    return this.get_kind();
  }

  set kind(value: number) {
    this.set_kind(value);
  }

  bodyVariant(): typeof FlyBrainEvent.bodyVariantDescriptors[number] | null {
    const tag = this.view.getUint8(1);
    return FlyBrainEvent.bodyVariantDescriptors.find((variant) => variant.tag === tag) ?? null;
  }

  body(): FlyBrainEvent_body_Inner {
    const descriptor = this.bodyVariant();
    if (!descriptor) throw new Error("FlyBrainEvent: unknown body variant");
    const offset = FlyBrainEvent.__tnFieldOffset_body;
    const remaining = this.buffer.length - offset;
    const payloadLength = descriptor.payloadSize ?? remaining;
    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error("FlyBrainEvent: payload exceeds buffer bounds");
    const slice = this.buffer.subarray(offset, offset + payloadLength);
    return FlyBrainEvent_body_Inner.__tnCreate(slice, descriptor, undefined);
  }
  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {
    return __tnEvalFootprint(__tn_ir_FlyBrainEvent.root, { params: __tnParams });
  }

  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): { ok: boolean; code?: string; consumed?: bigint } {
    return __tnValidateIrTree(__tn_ir_FlyBrainEvent, buffer, __tnParams);
  }

  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {
    return this.__tnFootprintInternal(__tnParams);
  }

  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {
    return this.__tnValidateInternal(buffer, __tnParams);
  }

  static footprintIr(body_kind: number | bigint): bigint {
    const params = FlyBrainEvent.Params.fromValues({
      body_kind: body_kind,
    });
    return this.footprintIrFromParams(params);
  }

  private static __tnPackParams(params: FlyBrainEvent.Params): Record<string, bigint> {
    const record: Record<string, bigint> = Object.create(null);
    record["body.kind"] = params.body_kind;
    record["FlyBrainEvent::body.kind"] = params.body_kind;
    return record;
  }

  static footprintIrFromParams(params: FlyBrainEvent.Params): bigint {
    const __tnParams = this.__tnPackParams(params);
    return this.__tnFootprintInternal(__tnParams);
  }

  static footprintFromParams(params: FlyBrainEvent.Params): number {
    const irResult = this.footprintIrFromParams(params);
    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);
    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for FlyBrainEvent');
    return __tnBigIntToNumber(irResult, 'FlyBrainEvent::footprintFromParams');
  }

  static footprintFromValues(input: { body_kind: number | bigint }): number {
    const params = FlyBrainEvent.params(input);
    return this.footprintFromParams(params);
  }

  static footprint(params: FlyBrainEvent.Params): number {
    return this.footprintFromParams(params);
  }

  static validate(buffer: Uint8Array, opts?: { params?: FlyBrainEvent.Params }): { ok: boolean; code?: string; consumed?: number; params?: FlyBrainEvent.Params } {
    if (!buffer || buffer.length === undefined) {
      return { ok: false, code: "tn.invalid_buffer" };
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const extracted = this.__tnExtractParams(view, buffer);
      if (!extracted) return { ok: false, code: "tn.param_extraction_failed" };
      params = extracted.params;
    }
    const __tnParamsRec = this.__tnPackParams(params);
    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);
    if (!irResult.ok) {
      return { ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'FlyBrainEvent::validate') : undefined, params };
    }
    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, 'FlyBrainEvent::validate') : undefined;
    return { ok: true, consumed, params };
  }

  static from_array(buffer: Uint8Array, opts?: { params?: FlyBrainEvent.Params }): FlyBrainEvent | null {
    if (!buffer || buffer.length === undefined) {
      return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let params = opts?.params ?? null;
    if (!params) {
      const derived = this.__tnExtractParams(view, buffer);
      if (!derived) return null;
      params = derived.params;
    }
    const validation = this.validate(buffer, { params });
    if (!validation.ok) {
      return null;
    }
    const cached = validation.params ?? params;
    const state = new FlyBrainEvent(buffer, cached);
    return state;
  }


}

export namespace FlyBrainEvent {
  export type Params = {
    /** ABI path: body.kind */
    readonly body_kind: bigint;
  };

  export const ParamKeys = Object.freeze({
    body_kind: "body.kind",
  } as const);

  export const Params = {
    fromValues(input: { body_kind: number | bigint }): Params {
      return {
        body_kind: __tnToBigInt(input.body_kind),
      };
    },
    fromBuilder(source: { dynamicParams(): Params } | { params: Params } | Params): Params {
      if ((source as { dynamicParams?: () => Params }).dynamicParams) {
        return (source as { dynamicParams(): Params }).dynamicParams();
      }
      if ((source as { params?: Params }).params) {
        return (source as { params: Params }).params;
      }
      return source as Params;
    }
  };

  export function params(input: { body_kind: number | bigint }): Params {
    return Params.fromValues(input);
  }
}

export class FlyBrainEventBuilder {
  private __tnPrefixBuffer: Uint8Array;
  private __tnPrefixView: DataView;
  private __tnField_kind: number | null = null;
  private __tnPayload_body: { descriptor: typeof FlyBrainEvent.bodyVariantDescriptors[number]; bytes: Uint8Array } | null = null;
  private __tnCachedParams: FlyBrainEvent.Params | null = null;
  private __tnLastBuffer: Uint8Array | null = null;
  private __tnLastParams: FlyBrainEvent.Params | null = null;
  private __tnVariantSelector_body?: __TnVariantSelectorResult<FlyBrainEventBuilder>;

  constructor() {
    this.__tnPrefixBuffer = new Uint8Array(2);
    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);
  }

  set_version(value: number): this {
    this.__tnPrefixView.setUint8(0, value);
    this.__tnInvalidate();
    return this;
  }

  private __tnInvalidate(): void {
    this.__tnCachedParams = null;
    this.__tnLastBuffer = null;
    this.__tnLastParams = null;
  }

  private __tnAssign_kind(value: number): void {
    this.__tnField_kind = value;
    this.__tnInvalidate();
  }

  set_kind(value: number): this {
    this.__tnAssign_kind(value);
    return this;
  }

  body(): __TnVariantSelectorResult<FlyBrainEventBuilder> {
    if (!this.__tnVariantSelector_body) {
      this.__tnVariantSelector_body = __tnCreateVariantSelector(this, FlyBrainEvent.bodyVariantDescriptors, (descriptor, payload) => {
        this.__tnPayload_body = { descriptor, bytes: new Uint8Array(payload) };
        this.__tnAssign_kind(descriptor.tag);
      });
    }
    return this.__tnVariantSelector_body!;
  }

  build(): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_kind === null) throw new Error("FlyBrainEventBuilder: field 'kind' must be set before build");
    if (!this.__tnPayload_body) throw new Error("FlyBrainEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_body.bytes.length;
    const requiredSize = 2 + payloadLength;
    const footprintSize = FlyBrainEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    const buffer = new Uint8Array(size);
    this.__tnWriteInto(buffer);
    this.__tnValidateOrThrow(buffer, params);
    return buffer;
  }

  buildInto(target: Uint8Array, offset = 0): Uint8Array {
    const params = this.__tnComputeParams();
    if (this.__tnField_kind === null) throw new Error("FlyBrainEventBuilder: field 'kind' must be set before build");
    if (!this.__tnPayload_body) throw new Error("FlyBrainEventBuilder: payload variant not selected");
    const payloadLength = this.__tnPayload_body.bytes.length;
    const requiredSize = 2 + payloadLength;
    const footprintSize = FlyBrainEvent.footprintFromParams(params);
    const size = Math.max(requiredSize, footprintSize);
    if (target.length - offset < size) throw new Error("FlyBrainEventBuilder: target buffer too small");
    const slice = target.subarray(offset, offset + size);
    this.__tnWriteInto(slice);
    this.__tnValidateOrThrow(slice, params);
    return target;
  }

  finish(): FlyBrainEvent {
    const buffer = this.build();
    const params = this.__tnLastParams ?? this.__tnComputeParams();
    const view = FlyBrainEvent.from_array(buffer, { params });
    if (!view) throw new Error("FlyBrainEventBuilder: failed to finalize view");
    return view;
  }

  finishView(): FlyBrainEvent {
    return this.finish();
  }

  dynamicParams(): FlyBrainEvent.Params {
    return this.__tnComputeParams();
  }

  private __tnComputeParams(): FlyBrainEvent.Params {
    if (this.__tnCachedParams) return this.__tnCachedParams;
    const params = FlyBrainEvent.Params.fromValues({
      body_kind: (() => { if (this.__tnField_kind === null) throw new Error("FlyBrainEventBuilder: missing enum tag"); return __tnToBigInt(this.__tnField_kind); })(),
    });
    this.__tnCachedParams = params;
    return params;
  }

  private __tnWriteInto(target: Uint8Array): void {
    if (this.__tnField_kind === null) throw new Error("FlyBrainEventBuilder: field 'kind' must be set before build");
    if (!this.__tnPayload_body) throw new Error("FlyBrainEventBuilder: payload variant not selected");
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
    target.set(this.__tnPrefixBuffer, 0);
    view.setUint8(1, this.__tnField_kind);
    target.set(this.__tnPayload_body.bytes, 2);
  }

  private __tnValidateOrThrow(buffer: Uint8Array, params: FlyBrainEvent.Params): void {
    const result = FlyBrainEvent.validate(buffer, { params });
    if (!result.ok) {
      throw new Error(`${ FlyBrainEvent }Builder: builder produced invalid buffer (code=${result.code ?? "unknown"})`);
    }
    this.__tnLastParams = result.params ?? params;
    this.__tnLastBuffer = buffer;
  }
}

__tnRegisterFootprint("FlyBrainEvent", (params) => FlyBrainEvent.__tnInvokeFootprint(params));
__tnRegisterValidate("FlyBrainEvent", (buffer, params) => FlyBrainEvent.__tnInvokeValidate(buffer, params));
__tnRegisterDynamicValidate("FlyBrainEvent", (buffer) => { const result = FlyBrainEvent.validate(buffer); const params = (result as { params?: Record<string, bigint> }).params; return { ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed), params }; });
