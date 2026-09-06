import { FormatRegistry, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export type ContractSchema = TSchema;
export type ContractValue<Schema extends ContractSchema> = Static<Schema>;

const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function registerContractFormats(): void {
  if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set(
      'date-time',
      (value) => dateTimePattern.test(value) && !Number.isNaN(Date.parse(value)),
    );
  }

  if (!FormatRegistry.Has('uri-reference')) {
    FormatRegistry.Set('uri-reference', (value) => {
      if (/\s/u.test(value)) return false;

      try {
        new URL(value, 'https://work-card.invalid');
        return true;
      } catch {
        return false;
      }
    });
  }

  if (!FormatRegistry.Has('uuid')) {
    FormatRegistry.Set('uuid', (value) => uuidPattern.test(value));
  }
}

export function isContractValue<Schema extends ContractSchema>(
  schema: Schema,
  value: unknown,
): value is ContractValue<Schema> {
  registerContractFormats();
  return Value.Check(schema, value);
}
