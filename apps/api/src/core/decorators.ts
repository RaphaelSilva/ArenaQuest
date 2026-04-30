import { z } from 'zod';
import type { ControllerResult } from './result';

const BodyIndices = new WeakMap<object, Map<string | symbol, number>>();

/**
 * Parameter decorator to mark which argument contains the request body.
 * If not provided, @ValidateBody will assume the first argument (index 0) is the body.
 */
export function Body() {
  return function (target: object, propertyKey: string | symbol, parameterIndex: number) {
    let targetMap = BodyIndices.get(target);
    if (!targetMap) {
      targetMap = new Map();
      BodyIndices.set(target, targetMap);
    }
    targetMap.set(propertyKey, parameterIndex);
  };
}

/**
 * Method decorator that validates the body parameter against a Zod schema.
 * Returns a 400 BadRequest ControllerResult if validation fails.
 * On success, replaces the unvalidated body argument with the parsed data.
 */
export function ValidateBody(schema: z.ZodTypeAny) {
  return function (target: object, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const targetMap = BodyIndices.get(target);
      const argIndex = targetMap?.get(propertyKey) ?? 0;

      const body = args[argIndex];
      const parsed = schema.safeParse(body);
      
      if (!parsed.success) {
        const errorResult: ControllerResult<unknown> = { 
          ok: false, 
          status: 400, 
          error: 'BadRequest', 
          meta: { details: parsed.error.flatten() } 
        };
        return errorResult;
      }

      // Replace the argument with the parsed, typed data
      args[argIndex] = parsed.data;

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
