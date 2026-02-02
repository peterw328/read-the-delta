# Signal Sentence Mapping (Hardcoded)

The AI must NOT generate signal sentences. They are injected verbatim by code.

## Code Location

`scripts/write_update.mjs` - `SIGNAL_SENTENCES` constant and `getSignalSentence()` function

## Mapping

```javascript
const SIGNAL_SENTENCES = {
  // Jobs dataset signals
  'decelerating|tight': 'Signal: decelerating. Labor market conditions remain tight.',
  'decelerating|loosening': 'Signal: decelerating. Labor market conditions are loosening.',
  'decelerating|neutral': 'Signal: decelerating. Labor market conditions are neutral.',
  'accelerating|tight': 'Signal: accelerating. Labor market conditions remain tight.',
  'accelerating|loosening': 'Signal: accelerating. Labor market conditions are loosening.',
  'accelerating|neutral': 'Signal: accelerating. Labor market conditions are neutral.',
  'steady|tight': 'Signal: steady. Labor market conditions remain tight.',
  'steady|loosening': 'Signal: steady. Labor market conditions are loosening.',
  'steady|neutral': 'Signal: steady. Labor market conditions are neutral.',
  
  // Inflation dataset signals
  'elevated|tight': 'Signal: elevated. Price pressures remain tight.',
  'elevated|easing': 'Signal: elevated. Price pressures are easing.',
  'elevated|neutral': 'Signal: elevated. Price pressures are neutral.',
  'moderating|tight': 'Signal: moderating. Price pressures remain tight.',
  'moderating|easing': 'Signal: moderating. Price pressures are easing.',
  'moderating|neutral': 'Signal: moderating. Price pressures are neutral.',
  'stable|tight': 'Signal: stable. Price pressures remain tight.',
  'stable|easing': 'Signal: stable. Price pressures are easing.',
  'stable|neutral': 'Signal: stable. Price pressures are neutral.'
};
```

## Function

```javascript
function getSignalSentence(signal) {
  if (!signal || !signal.state || !signal.pressure) {
    return 'Signal: not set.';
  }
  const key = `${signal.state.toLowerCase()}|${signal.pressure.toLowerCase()}`;
  return SIGNAL_SENTENCES[key] || `Signal: ${signal.state.toLowerCase()}. Conditions are ${signal.pressure.toLowerCase()}.`;
}
```

## Injection Point

The signal sentence is injected AFTER AI response, overriding any AI-generated context:

```javascript
// INJECT hardcoded signal sentence into context (override any AI attempt)
parsed.headline.context = signalSentence;
```

## Rules

- No slashes (/)
- No conjunction shortcuts
- No paraphrasing
- AI may reference the signal state but must not restate or reinterpret it
- The sentence is always two parts: "Signal: [state]." and "[Conditions description]."
