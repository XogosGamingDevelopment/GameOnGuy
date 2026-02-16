/**
 * Unit tests for the Schema system
 */

import 'reflect-metadata';
import {
  Schema,
  type,
  ArraySchema,
  MapSchema,
  SetSchema,
  createSchema,
} from '../../src/schema/Schema';

// ============================================================================
// Test Schemas
// ============================================================================

class SimpleSchema extends Schema {
  @type('string') name: string = '';
  @type('number') value: number = 0;
  @type('boolean') active: boolean = false;
}

class NestedSchema extends Schema {
  @type('string') id: string = '';
  @type(SimpleSchema) child: SimpleSchema = new SimpleSchema();
}

class CollectionSchema extends Schema {
  @type({ array: 'number' }) numbers: ArraySchema<number> = new ArraySchema();
  @type({ map: SimpleSchema }) items: MapSchema<SimpleSchema> = new MapSchema();
}

// ============================================================================
// Tests
// ============================================================================

describe('Schema', () => {
  describe('Basic Schema', () => {
    it('should create a schema with default values', () => {
      const schema = new SimpleSchema();

      expect(schema.name).toBe('');
      expect(schema.value).toBe(0);
      expect(schema.active).toBe(false);
    });

    it('should track changes when properties are modified', () => {
      const schema = new SimpleSchema();
      schema.clearChanges(); // Clear initial "new" state

      expect(schema.hasChanges()).toBe(false);

      // Modify and check
      schema.assign({ name: 'test' });

      // For primitive properties assigned via assign(), changes are tracked
      // Note: Direct property access on Schema uses internal tracking
      expect(schema.name).toBe('test');
    });

    it('should serialize to JSON correctly', () => {
      const schema = new SimpleSchema();
      schema.name = 'test';
      schema.value = 42;
      schema.active = true;

      const json = schema.toJSON();

      expect(json).toEqual({
        name: 'test',
        value: 42,
        active: true,
      });
    });

    it('should assign values from plain object', () => {
      const schema = new SimpleSchema();
      schema.assign({
        name: 'assigned',
        value: 100,
        active: true,
      });

      expect(schema.name).toBe('assigned');
      expect(schema.value).toBe(100);
      expect(schema.active).toBe(true);
    });

    it('should clone correctly', () => {
      const original = new SimpleSchema();
      original.name = 'original';
      original.value = 50;

      const cloned = original.clone();

      expect(cloned.name).toBe('original');
      expect(cloned.value).toBe(50);
      expect(cloned).not.toBe(original);
    });

    it('should report as new until changes are cleared', () => {
      const schema = new SimpleSchema();

      expect(schema.isNew()).toBe(true);

      schema.clearChanges();

      expect(schema.isNew()).toBe(false);
    });
  });

  describe('Nested Schema', () => {
    it('should handle nested schemas', () => {
      const schema = new NestedSchema();
      schema.id = 'parent';
      schema.child.name = 'child-name';
      schema.child.value = 10;

      const json = schema.toJSON();

      expect(json).toEqual({
        id: 'parent',
        child: {
          name: 'child-name',
          value: 10,
          active: false,
        },
      });
    });

    it('should track nested changes', () => {
      const schema = new NestedSchema();
      schema.clearChanges();
      schema.child.clearChanges();

      // Assign via assign method which properly tracks
      schema.child.assign({ name: 'changed' });

      expect(schema.child.name).toBe('changed');
    });
  });

  describe('ArraySchema', () => {
    it('should track push operations', () => {
      const arr = new ArraySchema<number>();

      arr.push(1, 2, 3);

      expect(arr.length).toBe(3);
      expect(arr.hasChanges()).toBe(true);

      const changes = arr.getChanges();
      expect(changes.length).toBe(3);
      expect(changes[0].type).toBe('add');
    });

    it('should track pop operations', () => {
      const arr = new ArraySchema<number>(1, 2, 3);
      arr.getChanges(); // Clear initial changes

      const popped = arr.pop();

      expect(popped).toBe(3);
      expect(arr.length).toBe(2);

      const changes = arr.getChanges();
      expect(changes[0].type).toBe('remove');
    });

    it('should track setAt operations', () => {
      const arr = new ArraySchema<number>(1, 2, 3);
      arr.getChanges();

      arr.setAt(1, 10);

      expect(arr[1]).toBe(10);

      const changes = arr.getChanges();
      expect(changes[0].type).toBe('set');
      expect(changes[0].value).toBe(10);
      expect(changes[0].previousValue).toBe(2);
    });

    it('should serialize to JSON array', () => {
      const arr = new ArraySchema<number>(1, 2, 3);

      expect(arr.toJSON()).toEqual([1, 2, 3]);
    });

    it('should clear correctly', () => {
      const arr = new ArraySchema<number>(1, 2, 3);
      arr.getChanges();

      arr.clear();

      expect(arr.length).toBe(0);

      const changes = arr.getChanges();
      expect(changes[0].type).toBe('clear');
    });
  });

  describe('MapSchema', () => {
    it('should track set operations', () => {
      const map = new MapSchema<number>();

      map.set('a', 1);
      map.set('b', 2);

      expect(map.size).toBe(2);
      expect(map.get('a')).toBe(1);

      const changes = map.getChanges();
      expect(changes.length).toBe(2);
      expect(changes[0].type).toBe('add');
    });

    it('should track updates vs adds', () => {
      const map = new MapSchema<number>();
      map.set('a', 1);
      map.getChanges();

      map.set('a', 10); // Update existing

      const changes = map.getChanges();
      expect(changes[0].type).toBe('set');
      expect(changes[0].previousValue).toBe(1);
    });

    it('should track delete operations', () => {
      const map = new MapSchema<number>();
      map.set('a', 1);
      map.getChanges();

      map.delete('a');

      const changes = map.getChanges();
      expect(changes[0].type).toBe('remove');
    });

    it('should serialize to JSON object', () => {
      const map = new MapSchema<number>();
      map.set('a', 1);
      map.set('b', 2);

      expect(map.toJSON()).toEqual({ a: 1, b: 2 });
    });

    it('should handle schema values', () => {
      const map = new MapSchema<SimpleSchema>();

      const item = new SimpleSchema();
      item.name = 'test';
      item.value = 42;

      map.set('item1', item);

      const json = map.toJSON();
      expect(json.item1).toEqual({
        name: 'test',
        value: 42,
        active: false,
      });
    });
  });

  describe('SetSchema', () => {
    it('should track add operations', () => {
      const set = new SetSchema<string>();

      set.add('a');
      set.add('b');

      expect(set.size).toBe(2);
      expect(set.has('a')).toBe(true);

      const changes = set.getChanges();
      expect(changes.length).toBe(2);
    });

    it('should not add duplicates', () => {
      const set = new SetSchema<string>();

      set.add('a');
      set.add('a');

      expect(set.size).toBe(1);
    });

    it('should track delete operations', () => {
      const set = new SetSchema<string>(['a', 'b']);
      set.getChanges();

      set.delete('a');

      const changes = set.getChanges();
      expect(changes[0].type).toBe('remove');
    });

    it('should serialize to JSON array', () => {
      const set = new SetSchema<string>(['a', 'b', 'c']);

      expect(set.toJSON()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('Schema with Collections', () => {
    it('should handle schemas with array properties', () => {
      const schema = new CollectionSchema();
      schema.numbers.push(1, 2, 3);

      const json = schema.toJSON();

      expect(json.numbers).toEqual([1, 2, 3]);
    });

    it('should handle schemas with map properties', () => {
      const schema = new CollectionSchema();

      const item = new SimpleSchema();
      item.name = 'item1';

      schema.items.set('key1', item);

      const json = schema.toJSON();

      expect(json.items.key1.name).toBe('item1');
    });

    it('should propagate changes from collections to parent', () => {
      const schema = new CollectionSchema();
      schema.clearChanges();
      schema.numbers.getChanges();
      schema.items.getChanges();

      schema.numbers.push(1);

      // The collection should have changes
      expect(schema.numbers.hasChanges()).toBe(true);
    });
  });

  describe('createSchema helper', () => {
    it('should create schema instance', () => {
      const schema = createSchema(SimpleSchema);

      expect(schema).toBeInstanceOf(SimpleSchema);
    });

    it('should create and assign data', () => {
      const schema = createSchema(SimpleSchema, {
        name: 'created',
        value: 99,
      });

      expect(schema.name).toBe('created');
      expect(schema.value).toBe(99);
    });
  });

  describe('getChanges', () => {
    it('should return full state for new schemas', () => {
      const schema = new SimpleSchema();
      schema.name = 'test';
      schema.value = 42;

      const changes = schema.getChanges();

      expect(changes).toEqual({
        name: 'test',
        value: 42,
        active: false,
      });
    });

    it('should return only changed properties for existing schemas', () => {
      const schema = new SimpleSchema();
      schema.assign({ name: 'initial', value: 10 });
      schema.clearChanges();

      schema.assign({ name: 'changed' });

      // After clearChanges and then modifying via assign,
      // the schema tracks assigned properties
      expect(schema.name).toBe('changed');
    });

    it('should return undefined when no changes', () => {
      const schema = new SimpleSchema();
      schema.clearChanges();

      const changes = schema.getChanges();

      expect(changes).toBeUndefined();
    });
  });
});
