import { ApiClientError } from './api-client.js';
import { AuditIntegrityError } from './admin-audit.js';
import { BatchCommandIntegrityError } from './batch-commands.js';
import { MasterCommandIntegrityError } from './master-commands.js';
import { PayrollCommandIntegrityError } from './payroll-commands.js';

export type TechnicalEntry = Readonly<{
  label: string;
  value: string | number | null;
}>;

export function technicalErrorEntries(error: unknown): TechnicalEntry[] {
  if (error instanceof AuditIntegrityError) {
    return [
      { label: 'Audit integrity check', value: error.message },
      ...error.readContexts.map((context, index) => ({
        label: `Audit request ID ${index + 1}`,
        value: context.requestId ?? null,
      })),
    ];
  }
  if (error instanceof BatchCommandIntegrityError) {
    return [
      { label: 'Integrity check', value: error.message },
      { label: 'Correlation ID', value: error.correlationId },
      { label: 'Command request ID', value: error.commandContext.requestId ?? null },
      { label: 'Read-back request ID', value: error.readBackContext.requestId ?? null },
    ];
  }
  if (error instanceof MasterCommandIntegrityError) {
    return [
      { label: 'Integrity check', value: error.message },
      { label: 'Correlation ID', value: error.correlationId },
      { label: 'Command request ID', value: error.commandContext.requestId ?? null },
      ...error.readBackContexts.map((context, index) => ({
        label: `Read-back request ID ${index + 1}`,
        value: context.requestId ?? null,
      })),
    ];
  }
  if (error instanceof PayrollCommandIntegrityError) {
    return [
      { label: 'Payroll integrity check', value: error.message },
      { label: 'Correlation ID', value: error.correlationId },
      { label: 'Command request ID', value: error.commandContext?.requestId ?? null },
      ...error.readBackContexts.map((context, index) => ({
        label: `Payroll read-back request ID ${index + 1}`,
        value: context.requestId ?? null,
      })),
    ];
  }
  if (!(error instanceof ApiClientError)) return [];
  return [
    { label: 'error kind', value: error.kind },
    { label: 'HTTP status', value: error.status },
    { label: 'request ID', value: error.context.requestId ?? null },
  ];
}
