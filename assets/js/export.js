export function serializeRequests(records, options) {
  return {
    format: 'gam-inspector',
    version: 1,
    exportedAt: new Date().toISOString(),
    redacted: {
      gdprConsent: options.hideGdprConsent,
      ppid: options.hidePpid,
    },
    requests: records.map((record) => ({
      id: record.id,
      startedDateTime: record.startedDateTime,
      duration: record.duration,
      httpStatus: record.httpStatus,
      slots: record.slots.map((slot) => {
        const result = { ...slot };
        if (options.hideGdprConsent) delete result.gdprConsent;
        if (options.hidePpid) delete result.ppid;
        return result;
      }),
    })),
  };
}
