import { DOCTOR_DECISIONS, EYE_SELECTIONS, eyesFor } from './rop';

describe('screening vocabulary', () => {
  it('puts both eyes in play for a two-eye screening', () => {
    expect(eyesFor('Both')).toEqual(['Left', 'Right']);
  });

  it('screens one eye on its own', () => {
    expect(eyesFor('Left')).toEqual(['Left']);
    expect(eyesFor('Right')).toEqual(['Right']);
  });

  it('covers every selection a client can send', () => {
    for (const selection of EYE_SELECTIONS) {
      expect(eyesFor(selection).length).toBeGreaterThan(0);
    }
  });

  it('starts a screening undecided, so the doctor has to answer', () => {
    expect(DOCTOR_DECISIONS[0]).toBe('Pending');
  });

  it('has no notion of a stage: the model does not produce one', () => {
    const vocabulary: string[] = [...EYE_SELECTIONS, ...DOCTOR_DECISIONS];
    expect(
      vocabulary.some((word) => word.toLowerCase().includes('stage')),
    ).toBe(false);
  });
});
