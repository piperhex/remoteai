import { expect, it } from 'vitest';
import { cliPickerModels, cliRequestEffort } from '../../../shared/cli-gui/modelSelection';
import { modelSelectionError, resolveModelSelection } from '../../../shared/conversation/modelSelection';

it.each([undefined, '', 'none', 'high'])('uses none for a model without reasoning, even with stale default %s', defaultEffort => {
  const model = { id: 'plain', label: 'Plain', defaultEffort, efforts: [] };
  const models = cliPickerModels([model]);
  expect(resolveModelSelection(models, { model: 'plain', effort: '' })).toEqual({ model: 'plain', effort: 'none' });
  expect(modelSelectionError(models, { model: 'plain', effort: 'none' })).toBeNull();
  expect(cliRequestEffort(model, 'none')).toBeUndefined();
  expect(cliRequestEffort(model, '')).toBeUndefined();
  expect(() => cliRequestEffort(model, 'high')).toThrow('invalidRequest');
});

it('preserves a real none option and validates reasoning-capable model choices', () => {
  const model = { id: 'reasoning', label: 'Reasoning', defaultEffort: 'high',
    efforts: [{ id: 'none', label: 'None' }, { id: 'high', label: 'High' }] };
  expect(cliRequestEffort(model)).toBe('high');
  expect(cliRequestEffort(model, 'none')).toBe('none');
  expect(() => cliRequestEffort(model, 'ultra')).toThrow('invalidRequest');
});
