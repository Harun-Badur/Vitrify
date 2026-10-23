const codes = [
  'INVENTORY_READ_FAILED', 'RECONCILIATION_FAILED', 'UPLOAD_FAILED',
  'STORAGE_JOURNAL_INVALID', 'STORAGE_JOURNAL_CHANGED', 'STORAGE_JOURNAL_MISSING', 'STORAGE_JOURNAL_UNVERIFIED',
  'STORAGE_OWNER_UNVERIFIED', 'STORAGE_OWNER_PATH_INVALID', 'STORAGE_UPLOAD_IN_FLIGHT', 'STORAGE_UPLOAD_UNRESOLVED',
  'STORAGE_RECONCILIATION_UNAVAILABLE', 'STORAGE_RECONCILIATION_UNVERIFIED', 'STORAGE_UPLOAD_UNCONFIRMED',
  'STORAGE_UPLOAD_RESPONSE_INVALID', 'STORAGE_STATUS_PENDING', 'MODEL_PHOTO_TOO_LARGE',
  'CUTOUT_TRANSPORT_REJECTED', 'CUTOUT_HTTP_REJECTED', 'CUTOUT_NO_RESPONSE', 'CUTOUT_RESPONSE_INVALID', 'CUTOUT_PNG_INVALID',
] as const;
type Code = typeof codes[number];
type Stage = 'storageCheck' | 'upload' | 'cutoutProvider';
const transports = ['unknown', 'http', 'relay', 'fetch', 'native'] as const;
type Transport = typeof transports[number];
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const status = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

/** Only SDK class and numeric status are inspected. Never read/clone a response body. */
export function wardrobeNetworkErrorMetadata(error: unknown): { diagnosticTransport: Transport; diagnosticHttpStatus: number | null } {
  try {
    const source = object(error);
    const sdk = source.name === 'FunctionsHttpError' || source.name === 'StorageApiError' ? 'http' : source.name === 'FunctionsRelayError' ? 'relay' : source.name === 'FunctionsFetchError' ? 'fetch' : 'unknown';
    return {
      diagnosticTransport: transports.includes(source.diagnosticTransport as Transport) ? source.diagnosticTransport as Transport : sdk,
      diagnosticHttpStatus: status(source.diagnosticHttpStatus) ?? (source.name === 'StorageApiError' ? status(source.status) : sdk === 'http' || sdk === 'relay' ? status(object(source.context).status) : null),
    };
  } catch { return { diagnosticTransport: 'unknown', diagnosticHttpStatus: null }; }
}

export function recordWardrobeNetworkFailure(stage: Stage, error: unknown, fallback: Code): void {
  if (!__DEV__) return;
  try {
    const source = object(error), candidate = source.diagnosticCode ?? source.code;
    const code = codes.includes(candidate as Code) ? candidate as Code : fallback;
    const meta = wardrobeNetworkErrorMetadata(error);
    console.info(JSON.stringify({ type: 'wardrobe_network_failure', stage, code, transport: meta.diagnosticTransport, httpStatus: meta.diagnosticHttpStatus }));
  } catch { /* Diagnostics cannot change dispatch, journal or retry behavior. */ }
}

const cutoutFailureCodes = {
  cutout: 'CUTOUT_SETUP_FAILED', cutoutPrepare: 'CUTOUT_PREPARE_FAILED',
  cutoutProvider: 'CUTOUT_PROVIDER_FAILED', cutoutDecode: 'CUTOUT_DECODE_FAILED',
  cutoutWrite: 'CUTOUT_WRITE_FAILED', cutoutUpload: 'CUTOUT_UPLOAD_FAILED',
  cutoutSign: 'CUTOUT_SIGN_FAILED', cutoutCheckpoint: 'CUTOUT_CHECKPOINT_FAILED',
} as const;
const cutoutCodes = [
  ...codes, ...Object.values(cutoutFailureCodes), 'CUTOUT_NATIVE_UNAVAILABLE',
  'CUTOUT_CONFIG_MISSING', 'CUTOUT_CONFIG_INVALID', 'CUTOUT_SESSION_UNVERIFIED',
  'CUTOUT_DIRECTORY_UNAVAILABLE', 'CUTOUT_STORAGE_OWNER_MISMATCH',
  'CUTOUT_STORAGE_UNKNOWN', 'CUTOUT_ARTIFACT_MISSING',
  'CUTOUT_LOCAL_SOURCE_REQUIRED', 'CUTOUT_OWNER_CHANGED', 'CUTOUT_NATIVE_BUSY',
  'CUTOUT_NATIVE_RESULT_INVALID', 'CUTOUT_NATIVE_WRITE_UNVERIFIED', 'CUTOUT_NATIVE_FAILED',
  'CUTOUT_NATIVE_ARTIFACT_MISSING', 'CUTOUT_NATIVE_ARTIFACT_MISMATCH', 'CUTOUT_NATIVE_WRITE_FAILED',
  'CUTOUT_NATIVE_PATH_INVALID', 'CUTOUT_NATIVE_INPUT_INVALID', 'CUTOUT_NATIVE_MEMORY_LIMIT',
  'CUTOUT_NATIVE_DECODE_FAILED', 'CUTOUT_NATIVE_MODEL_INVALID', 'CUTOUT_NATIVE_OUTPUT_INVALID', 'CUTOUT_NATIVE_MASK_INVALID',
];
const diagnosedCutoutErrors = new WeakSet<object>();
/** Keep the innermost failure, with fixed fields only; never emit a LogBox warning. */
export function recordWardrobeCutoutFailure(stage: string, error: unknown): void {
  if (!__DEV__ || !Object.prototype.hasOwnProperty.call(cutoutFailureCodes, stage)) return;
  try {
    if (error !== null && typeof error === 'object' && diagnosedCutoutErrors.has(error)) return;
    const source = object(error), candidate = source.diagnosticCode ?? source.code;
    const code = candidate === 'ERR_UNAVAILABLE' ? 'CUTOUT_NATIVE_UNAVAILABLE' :
      typeof candidate === 'string' && cutoutCodes.includes(candidate) ? candidate : cutoutFailureCodes[stage as keyof typeof cutoutFailureCodes];
    console.info(JSON.stringify({ type: 'wardrobe_cutout_failure', stage, code, httpStatus: wardrobeNetworkErrorMetadata(error).diagnosticHttpStatus }));
    if (error !== null && typeof error === 'object') diagnosedCutoutErrors.add(error);
  } catch { /* Diagnostics never affect journal, retry or publication. */ }
}
