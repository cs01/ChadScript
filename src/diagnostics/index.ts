export { enableSink, isSinkEnabled, recordEvent, flushDiagnostics } from "./sink.js";
export { CAT_TYPE_TRACE, KNOWN_CATEGORIES, parseCategories } from "./categories.js";
export {
  enableTypeTrace,
  isTypeTraceEnabled,
  traceTypeSet,
  traceTypeGet,
  traceTypeRich,
} from "./tracers.js";
