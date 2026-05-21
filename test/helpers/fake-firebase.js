'use strict';

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function pathParts(path) {
  return String(path || '').split('/').filter(Boolean);
}

function createFakeFirebase(seed = {}) {
  const data = clone(seed) || {};
  const pushes = [];
  const removals = [];
  const sets = [];
  let nextPushId = 1;

  function getValue(path) {
    return pathParts(path).reduce((value, key) => value?.[key], data);
  }

  function setValue(path, value) {
    const parts = pathParts(path);
    const last = parts.pop();
    let parent = data;

    parts.forEach((key) => {
      parent[key] ||= {};
      parent = parent[key];
    });

    parent[last] = clone(value);
  }

  function removeValue(path) {
    const parts = pathParts(path);
    const last = parts.pop();
    const parent = parts.reduce((value, key) => value?.[key], data);

    if (parent && Object.hasOwn(parent, last)) {
      delete parent[last];
    }
  }

  const ops = {
    ref(_, path) {
      return String(path || '');
    },
    async get(path) {
      const value = getValue(path);

      return {
        exists: () => value !== undefined && value !== null,
        val: () => clone(value) ?? null,
      };
    },
    async push(path, value) {
      const id = `push_${nextPushId++}`;

      setValue(`${path}/${id}`, value);
      pushes.push({ id, path, value: clone(value) });

      return { key: id };
    },
    async remove(path) {
      removals.push(String(path || ''));
      removeValue(path);
    },
    async set(path, value) {
      sets.push({ path, value: clone(value) });
      setValue(path, value);
    },
  };

  return {
    data,
    getValue,
    ops,
    pushes,
    removals,
    sets,
  };
}

module.exports = {
  createFakeFirebase,
};
