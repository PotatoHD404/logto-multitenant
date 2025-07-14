export const PASSWORD_POLICY_SYMBOLS = Object.freeze(
  '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ ' as const
);

export const PASSWORD_POLICY_SEQUENCE = Object.freeze([
  '0123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1qaz',
  '2wsx',
  '3edc',
  '4rfv',
  '5tgb',
  '6yhn',
  '7ujm',
  '8ik',
  '9ol',
] as const);

export const REPETITION_AND_SEQUENCE_THRESHOLD = 3;
export const RESTRICTED_PHRASES_TOLERANCE = 3;

export const getRestrictedPhraseThreshold = (password: string): number =>
  Math.max(1, password.length - RESTRICTED_PHRASES_TOLERANCE);

export const isSequential = (value: string): boolean => {
  for (const seq of PASSWORD_POLICY_SEQUENCE) {
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- created a new array before mutating
    const reversedSeq = [...seq].reverse().join('');
    if (
      [seq, reversedSeq, seq.toUpperCase(), reversedSeq.toUpperCase()].some((item) =>
        item.includes(value)
      )
    ) {
      return true;
    }
  }
  return false;
};
