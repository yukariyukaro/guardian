import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormatsImport } from 'ajv-formats';
import type { FastifyInstance } from 'fastify';

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;

/** OpenAPI 3.1 uses JSON Schema 2020-12. Do not silently strip forbidden query/DTO fields. */
export function registerValidation(app: FastifyInstance): void {
  const input = addFormats(new Ajv2020({
    coerceTypes: true,
    useDefaults: true,
    removeAdditional: false,
    allErrors: false,
    strict: false,
  }));
  const output = addFormats(new Ajv2020({
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    allErrors: false,
    strict: false,
  }));

  app.setValidatorCompiler(({ schema }) => input.compile(schema as object));
  app.setSerializerCompiler(({ schema }) => {
    const validate = output.compile(schema as object);
    return (value) => {
      if (!validate(value)) {
        // Never emit invalid data or include DTO contents in an error/log entry.
        throw new Error('Response does not satisfy the shared API contract');
      }
      return JSON.stringify(value);
    };
  });
}
