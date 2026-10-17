import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Robert's videos 13.10.2026: after Onboarding „Über dich" a thin line stayed
// across every later screen. Google's Places Autocomplete appends its
// `.pac-container` dropdown to <body> and never removes it when the input
// unmounts; with billing off it hung there empty, showing only its 1px top
// border. createPlacesAutocomplete's dispose() must take exactly its own
// dropdown away — never another field's.
vi.mock('../i18n', () => ({ default: { language: 'de' } }));

import { createPlacesAutocomplete } from '../utils/googleMaps';

const pacCount = () => document.querySelectorAll('.pac-container').length;

function installFakeGoogle({ eager }) {
  const clearInstanceListeners = vi.fn();
  class Autocomplete {
    constructor(input, options) {
      this.input = input;
      this.options = options;
      this.pac = document.createElement('div');
      this.pac.className = 'pac-container';
      // Eager: Google builds the dropdown with the instance. Lazy: only once
      // the field is used — dispose() must find it then as well.
      if (eager) document.body.appendChild(this.pac);
    }
    showDropdown() { document.body.appendChild(this.pac); }
  }
  window.google = { maps: { places: { Autocomplete }, event: { clearInstanceListeners } } };
  return { clearInstanceListeners };
}

describe('createPlacesAutocomplete', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { delete window.google; });

  it('removes its own dropdown and clears the listeners on dispose', () => {
    const { clearInstanceListeners } = installFakeGoogle({ eager: true });
    const input = document.createElement('input');
    const { autocomplete, dispose } = createPlacesAutocomplete(input, { types: ['(cities)'] });

    expect(autocomplete.input).toBe(input);
    expect(autocomplete.options).toEqual({ types: ['(cities)'] });
    expect(pacCount()).toBe(1);

    dispose();
    expect(pacCount()).toBe(0);
    expect(clearInstanceListeners).toHaveBeenCalledWith(autocomplete);
  });

  it('leaves dropdowns that belong to other fields alone', () => {
    installFakeGoogle({ eager: true });
    const older = createPlacesAutocomplete(document.createElement('input'), {});
    const newer = createPlacesAutocomplete(document.createElement('input'), {});
    expect(pacCount()).toBe(2);

    older.dispose();
    expect(pacCount()).toBe(1);
    expect(newer.autocomplete.pac.isConnected).toBe(true);

    newer.dispose();
    expect(pacCount()).toBe(0);
  });

  it('also removes a dropdown Google only adds once the field is used', () => {
    installFakeGoogle({ eager: false });
    const { autocomplete, dispose } = createPlacesAutocomplete(document.createElement('input'), {});
    expect(pacCount()).toBe(0);

    autocomplete.showDropdown();
    expect(pacCount()).toBe(1);

    dispose();
    expect(pacCount()).toBe(0);
  });

  it('is safe to call twice', () => {
    installFakeGoogle({ eager: true });
    const { dispose } = createPlacesAutocomplete(document.createElement('input'), {});
    dispose();
    expect(() => dispose()).not.toThrow();
    expect(pacCount()).toBe(0);
  });
});
