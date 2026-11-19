/**
 * Begin an authorized, independent, read-only visual observation without
 * waiting for subtitle/ASR. This helper does not grant model permissions,
 * choose a viewing depth, write memory, or treat a returned model answer as
 * verified evidence. All those gates remain in the calling Life pipeline.
 */
export function beginVideoObservationRead(read, onSettled = () => {}) {
  if (typeof read !== 'function' || typeof onSettled !== 'function')
    throw new TypeError('video observation requires controlled callbacks')
  const started = Date.now()
  const settle = () => onSettled(Math.max(0, Date.now() - started))
  return Promise.resolve().then(read).then(
    result => {settle();return result},
    error => {settle();throw error}
  )
}
