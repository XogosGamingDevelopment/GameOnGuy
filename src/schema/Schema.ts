/**
 * Game On Dude! - Schema System
 * www.gameonguy.com
 *
 * A decorator-based schema system for defining synchronizable game state.
 * Similar to Colyseus @type() decorators, this provides:
 * - Automatic serialization/deserialization
 * - Type metadata for efficient binary encoding
 * - Change tracking integration
 * - Nested schema support
 *
 * @example
 * ```typescript
 * class Player extends Schema {
 *   @type("string") id: string = "";
 *   @type("number") x: number = 0;
 *   @type("number") y: number = 0;
 *   @type("boolean") isAlive: boolean = true;
 * }
 *
 * class GameState extends Schema {
 *   @type("string") phase: string = "waiting";
 *   @type({ map: Player }) players = new MapSchema<Player>();
 *   @type({ array: "number" }) scores: ArraySchema<number> = new ArraySchema();
 * }
 * ```
 */

import 'reflect-metadata';

// ============================================================================
// Type Definitions
// ============================================================================

/** Primitive types supported by the schema system */
export type PrimitiveType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'float32'
  | 'float64';

/** Complex type definitions for arrays and maps */
export interface ArrayType {
  array: PrimitiveType | typeof Schema;
}

export interface MapType {
  map: PrimitiveType | typeof Schema;
}

export interface SetType {
  set: PrimitiveType | typeof Schema;
}

/** All supported schema types */
export type SchemaType = PrimitiveType | ArrayType | MapType | SetType | typeof Schema;

/** Metadata stored for each decorated property */
export interface PropertyMetadata {
  name: string;
  type: SchemaType;
  index: number;
  isArray: boolean;
  isMap: boolean;
  isSet: boolean;
  isSchema: boolean;
  childType?: PrimitiveType | typeof Schema;
}

/** Metadata key for storing schema information */
const SCHEMA_METADATA_KEY = Symbol('schema:metadata');
const SCHEMA_PROPERTIES_KEY = Symbol('schema:properties');

// ============================================================================
// Schema Registry
// ============================================================================

/** Global registry of all schema classes */
const schemaRegistry = new Map<string, typeof Schema>();

/** Get or create a unique type ID for a schema class */
let typeIdCounter = 0;
const typeIdMap = new WeakMap<typeof Schema, number>();

function getTypeId(schemaClass: typeof Schema): number {
  let id = typeIdMap.get(schemaClass);
  if (id === undefined) {
    id = typeIdCounter++;
    typeIdMap.set(schemaClass, id);
  }
  return id;
}

// ============================================================================
// Decorators
// ============================================================================

/**
 * Property decorator for defining schema fields.
 *
 * @param schemaType - The type of the property
 * @returns Property decorator
 *
 * @example
 * ```typescript
 * class MyState extends Schema {
 *   @type("string") name: string = "";
 *   @type("number") score: number = 0;
 *   @type({ array: "number" }) items = new ArraySchema<number>();
 *   @type({ map: Player }) players = new MapSchema<Player>();
 * }
 * ```
 */
export function type(schemaType: SchemaType): PropertyDecorator {
  return function (target: any, propertyKey: string | symbol) {
    const key = String(propertyKey);

    // Get or create properties map for this class
    let properties: Map<string, PropertyMetadata> = Reflect.getMetadata(
      SCHEMA_PROPERTIES_KEY,
      target.constructor
    );

    if (!properties) {
      // Check parent class for inherited properties
      const parentProperties: Map<string, PropertyMetadata> | undefined = Reflect.getMetadata(
        SCHEMA_PROPERTIES_KEY,
        Object.getPrototypeOf(target.constructor)
      );

      properties = new Map(parentProperties || []);
      Reflect.defineMetadata(SCHEMA_PROPERTIES_KEY, properties, target.constructor);
    }

    // Determine property characteristics
    const isArray = typeof schemaType === 'object' && 'array' in schemaType;
    const isMap = typeof schemaType === 'object' && 'map' in schemaType;
    const isSet = typeof schemaType === 'object' && 'set' in schemaType;
    const isSchema =
      typeof schemaType === 'function' && schemaType.prototype instanceof Schema;

    let childType: PrimitiveType | typeof Schema | undefined;
    if (isArray) childType = (schemaType as ArrayType).array;
    else if (isMap) childType = (schemaType as MapType).map;
    else if (isSet) childType = (schemaType as SetType).set;

    const metadata: PropertyMetadata = {
      name: key,
      type: schemaType,
      index: properties.size,
      isArray,
      isMap,
      isSet,
      isSchema,
      childType,
    };

    properties.set(key, metadata);
  };
}

/**
 * Class decorator for registering schema classes.
 *
 * @param name - Optional name for the schema (defaults to class name)
 * @returns Class decorator
 */
export function schema(name?: string): ClassDecorator {
  return function (target: any) {
    const schemaName = name || target.name;
    schemaRegistry.set(schemaName, target);
    Reflect.defineMetadata(SCHEMA_METADATA_KEY, { name: schemaName }, target);
    return target;
  };
}

// ============================================================================
// Collection Classes
// ============================================================================

/** Event types for collection changes */
export type CollectionChangeType = 'add' | 'remove' | 'set' | 'clear';

export interface CollectionChange<T> {
  type: CollectionChangeType;
  index?: number | string;
  value?: T;
  previousValue?: T;
}

/**
 * Observable array that tracks changes for synchronization.
 */
export class ArraySchema<T = any> extends Array<T> {
  private _changes: CollectionChange<T>[] = [];
  private _parent?: Schema;
  private _parentKey?: string;

  constructor(...items: T[]) {
    super(...items);
    Object.setPrototypeOf(this, ArraySchema.prototype);
  }

  /** Create from plain array - static factory method */
  static fromArray<T>(array: T[], itemType?: new () => Schema): ArraySchema<T> {
    const result = new ArraySchema<T>();
    array.forEach((item) => {
      if (itemType && typeof item === 'object' && item !== null) {
        const schemaItem = new itemType() as unknown as T;
        (schemaItem as Schema).assign(item as Record<string, any>);
        result.push(schemaItem);
      } else {
        result.push(item);
      }
    });
    return result;
  }

  /** Get and clear pending changes */
  getChanges(): CollectionChange<T>[] {
    const changes = [...this._changes];
    this._changes = [];
    return changes;
  }

  /** Check if there are pending changes */
  hasChanges(): boolean {
    return this._changes.length > 0;
  }

  /** Set parent schema for change propagation */
  setParent(parent: Schema, key: string): void {
    this._parent = parent;
    this._parentKey = key;
  }

  private recordChange(change: CollectionChange<T>): void {
    this._changes.push(change);
    if (this._parent) {
      this._parent['_markDirty'](this._parentKey!);
    }
  }

  // Override array methods to track changes
  push(...items: T[]): number {
    const startIndex = this.length;
    const result = super.push(...items);
    items.forEach((item, i) => {
      this.recordChange({ type: 'add', index: startIndex + i, value: item });
    });
    return result;
  }

  pop(): T | undefined {
    if (this.length === 0) return undefined;
    const index = this.length - 1;
    const value = this[index];
    const result = super.pop();
    this.recordChange({ type: 'remove', index, previousValue: value });
    return result;
  }

  shift(): T | undefined {
    if (this.length === 0) return undefined;
    const value = this[0];
    const result = super.shift();
    this.recordChange({ type: 'remove', index: 0, previousValue: value });
    return result;
  }

  unshift(...items: T[]): number {
    const result = super.unshift(...items);
    items.forEach((item, i) => {
      this.recordChange({ type: 'add', index: i, value: item });
    });
    return result;
  }

  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    const removed = super.splice(start, deleteCount ?? 0, ...items);
    removed.forEach((item, i) => {
      this.recordChange({ type: 'remove', index: start + i, previousValue: item });
    });
    items.forEach((item, i) => {
      this.recordChange({ type: 'add', index: start + i, value: item });
    });
    return removed;
  }

  setAt(index: number, value: T): void {
    const previousValue = this[index];
    this[index] = value;
    this.recordChange({ type: 'set', index, value, previousValue });
  }

  clear(): void {
    const previousLength = this.length;
    super.splice(0, previousLength);
    this.recordChange({ type: 'clear' });
  }

  /** Convert to plain array for serialization */
  toJSON(): T[] {
    return Array.from(this).map((item) =>
      item instanceof Schema ? item.toJSON() : item
    ) as T[];
  }
}

/**
 * Observable map that tracks changes for synchronization.
 */
export class MapSchema<T = any> extends Map<string, T> {
  private _changes: CollectionChange<T>[] = [];
  private _parent?: Schema;
  private _parentKey?: string;

  constructor(entries?: readonly (readonly [string, T])[] | null) {
    super(entries);
  }

  /** Get and clear pending changes */
  getChanges(): CollectionChange<T>[] {
    const changes = [...this._changes];
    this._changes = [];
    return changes;
  }

  /** Check if there are pending changes */
  hasChanges(): boolean {
    return this._changes.length > 0;
  }

  /** Set parent schema for change propagation */
  setParent(parent: Schema, key: string): void {
    this._parent = parent;
    this._parentKey = key;
  }

  private recordChange(change: CollectionChange<T>): void {
    this._changes.push(change);
    if (this._parent) {
      this._parent['_markDirty'](this._parentKey!);
    }
  }

  // Override map methods to track changes
  set(key: string, value: T): this {
    const previousValue = this.get(key);
    const isNew = !this.has(key);
    super.set(key, value);
    this.recordChange({
      type: isNew ? 'add' : 'set',
      index: key,
      value,
      previousValue,
    });
    return this;
  }

  delete(key: string): boolean {
    const previousValue = this.get(key);
    const result = super.delete(key);
    if (result) {
      this.recordChange({ type: 'remove', index: key, previousValue });
    }
    return result;
  }

  clear(): void {
    super.clear();
    this.recordChange({ type: 'clear' });
  }

  /** Convert to plain object for serialization */
  toJSON(): Record<string, any> {
    const result: Record<string, any> = {};
    this.forEach((value, key) => {
      result[key] = value instanceof Schema ? value.toJSON() : value;
    });
    return result;
  }

  /** Create from plain object - static factory method */
  static fromObject<T>(
    obj: Record<string, any>,
    itemType?: new () => Schema
  ): MapSchema<T> {
    const result = new MapSchema<T>();
    Object.entries(obj).forEach(([key, value]) => {
      if (itemType && typeof value === 'object' && value !== null) {
        const schemaItem = new itemType() as unknown as T;
        (schemaItem as Schema).assign(value);
        result.set(key, schemaItem);
      } else {
        result.set(key, value as T);
      }
    });
    return result;
  }
}

/**
 * Observable set that tracks changes for synchronization.
 */
export class SetSchema<T = any> extends Set<T> {
  private _changes: CollectionChange<T>[] = [];
  private _parent?: Schema;
  private _parentKey?: string;

  constructor(values?: readonly T[] | null) {
    super();
    // Initialize _changes before adding values
    this._changes = [];
    if (values) {
      values.forEach(v => super.add(v));
    }
  }

  /** Get and clear pending changes */
  getChanges(): CollectionChange<T>[] {
    const changes = [...this._changes];
    this._changes = [];
    return changes;
  }

  /** Check if there are pending changes */
  hasChanges(): boolean {
    return this._changes.length > 0;
  }

  /** Set parent schema for change propagation */
  setParent(parent: Schema, key: string): void {
    this._parent = parent;
    this._parentKey = key;
  }

  private recordChange(change: CollectionChange<T>): void {
    this._changes.push(change);
    if (this._parent) {
      this._parent['_markDirty'](this._parentKey!);
    }
  }

  // Override set methods to track changes
  add(value: T): this {
    if (!this.has(value)) {
      super.add(value);
      this.recordChange({ type: 'add', value });
    }
    return this;
  }

  delete(value: T): boolean {
    const result = super.delete(value);
    if (result) {
      this.recordChange({ type: 'remove', previousValue: value });
    }
    return result;
  }

  clear(): void {
    super.clear();
    this.recordChange({ type: 'clear' });
  }

  /** Convert to plain array for serialization */
  toJSON(): T[] {
    return Array.from(this).map((item) =>
      item instanceof Schema ? item.toJSON() : item
    ) as T[];
  }
}

// ============================================================================
// Base Schema Class
// ============================================================================

/**
 * Base class for all schema-defined state objects.
 * Provides automatic change tracking, serialization, and synchronization.
 */
export abstract class Schema {
  /** Properties that have been modified since last sync */
  private _dirtyProperties: Set<string> = new Set();

  /** Previous values for change detection */
  private _previousValues: Map<string, any> = new Map();

  /** Whether the entire schema needs sync (e.g., after creation) */
  private _isNew: boolean = true;

  /** Unique instance ID for tracking */
  private _$id: string;

  /** Type ID for serialization */
  readonly _$typeId: number;

  constructor() {
    this._$id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this._$typeId = getTypeId(this.constructor as typeof Schema);
    this._initializeProperties();
  }

  /** Initialize properties and set up change tracking */
  private _initializeProperties(): void {
    const properties = this._getProperties();

    properties.forEach((meta, key) => {
      let value = (this as any)[key];

      // Initialize collections with parent reference
      if (value instanceof ArraySchema) {
        value.setParent(this, key);
      } else if (value instanceof MapSchema) {
        value.setParent(this, key);
      } else if (value instanceof SetSchema) {
        value.setParent(this, key);
      }

      // Store initial value
      this._previousValues.set(key, this._cloneValue(value));

      // Create property getter/setter for primitives and schema types
      if (!meta.isArray && !meta.isMap && !meta.isSet) {
        const internalKey = `_${key}`;
        (this as any)[internalKey] = value;

        Object.defineProperty(this, key, {
          get() {
            return (this as any)[internalKey];
          },
          set(newValue) {
            const oldValue = (this as any)[internalKey];
            if (oldValue !== newValue) {
              (this as any)[internalKey] = newValue;
              this._markDirty(key);
            }
          },
          enumerable: true,
          configurable: true,
        });
      }
    });
  }

  /** Mark a property as dirty (changed) */
  protected _markDirty(propertyKey: string): void {
    this._dirtyProperties.add(propertyKey);
  }

  /** Get property metadata for this schema */
  protected _getProperties(): Map<string, PropertyMetadata> {
    return (
      Reflect.getMetadata(SCHEMA_PROPERTIES_KEY, this.constructor) ||
      new Map<string, PropertyMetadata>()
    );
  }

  /** Clone a value for comparison */
  private _cloneValue(value: any): any {
    if (value === null || value === undefined) return value;
    if (value instanceof Schema) return value.toJSON();
    if (value instanceof ArraySchema) return value.toJSON();
    if (value instanceof MapSchema) return value.toJSON();
    if (value instanceof SetSchema) return value.toJSON();
    if (typeof value === 'object') return JSON.parse(JSON.stringify(value));
    return value;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /** Get the unique instance ID */
  get $id(): string {
    return this._$id;
  }

  /** Check if this schema has any changes pending */
  hasChanges(): boolean {
    if (this._isNew || this._dirtyProperties.size > 0) return true;

    // Check nested collections
    const properties = this._getProperties();
    for (const [key, meta] of properties) {
      const value = (this as any)[key];
      if (value instanceof ArraySchema && value.hasChanges()) return true;
      if (value instanceof MapSchema && value.hasChanges()) return true;
      if (value instanceof SetSchema && value.hasChanges()) return true;
      if (value instanceof Schema && value.hasChanges()) return true;
    }

    return false;
  }

  /** Get changed properties since last sync */
  getChangedProperties(): string[] {
    return Array.from(this._dirtyProperties);
  }

  /** Clear change tracking (call after sync) */
  clearChanges(): void {
    this._isNew = false;
    this._dirtyProperties.clear();

    // Update previous values and clear nested changes
    const properties = this._getProperties();
    properties.forEach((meta, key) => {
      const value = (this as any)[key];
      this._previousValues.set(key, this._cloneValue(value));

      if (value instanceof ArraySchema) value.getChanges();
      if (value instanceof MapSchema) value.getChanges();
      if (value instanceof SetSchema) value.getChanges();
      if (value instanceof Schema) value.clearChanges();
    });
  }

  /** Check if this is a newly created schema */
  isNew(): boolean {
    return this._isNew;
  }

  /**
   * Get only the changed data for delta synchronization.
   * Returns undefined if no changes.
   */
  getChanges(): Record<string, any> | undefined {
    if (!this.hasChanges()) return undefined;

    if (this._isNew) {
      return this.toJSON();
    }

    const changes: Record<string, any> = {};
    const properties = this._getProperties();

    for (const [key, meta] of properties) {
      const value = (this as any)[key];

      if (this._dirtyProperties.has(key)) {
        changes[key] = value instanceof Schema ? value.toJSON() : value;
      } else if (meta.isArray && value instanceof ArraySchema && value.hasChanges()) {
        changes[key] = { $changes: value.getChanges(), $value: value.toJSON() };
      } else if (meta.isMap && value instanceof MapSchema && value.hasChanges()) {
        changes[key] = { $changes: value.getChanges(), $value: value.toJSON() };
      } else if (meta.isSet && value instanceof SetSchema && value.hasChanges()) {
        changes[key] = { $changes: value.getChanges(), $value: value.toJSON() };
      } else if (value instanceof Schema && value.hasChanges()) {
        const nestedChanges = value.getChanges();
        if (nestedChanges) {
          changes[key] = nestedChanges;
        }
      }
    }

    return Object.keys(changes).length > 0 ? changes : undefined;
  }

  /**
   * Serialize the schema to a plain object (full state).
   */
  toJSON(): Record<string, any> {
    const result: Record<string, any> = {};
    const properties = this._getProperties();

    properties.forEach((meta, key) => {
      const value = (this as any)[key];

      if (value === undefined) {
        result[key] = undefined;
      } else if (value === null) {
        result[key] = null;
      } else if (value instanceof Schema) {
        result[key] = value.toJSON();
      } else if (value instanceof ArraySchema) {
        result[key] = value.toJSON();
      } else if (value instanceof MapSchema) {
        result[key] = value.toJSON();
      } else if (value instanceof SetSchema) {
        result[key] = value.toJSON();
      } else {
        result[key] = value;
      }
    });

    return result;
  }

  /**
   * Apply data from a plain object to this schema.
   */
  assign(data: Record<string, any>): this {
    const properties = this._getProperties();

    for (const [key, value] of Object.entries(data)) {
      const meta = properties.get(key);
      if (!meta) continue;

      if (meta.isArray) {
        const arr = (this as any)[key] as ArraySchema;
        if (arr) {
          arr.clear();
          if (Array.isArray(value)) {
            value.forEach((item) => {
              if (meta.childType && typeof meta.childType === 'function') {
                // Cast through unknown to avoid abstract class instantiation errors
                const SchemaClass = meta.childType as unknown as new () => Schema;
                const schemaItem = new SchemaClass();
                schemaItem.assign(item);
                arr.push(schemaItem);
              } else {
                arr.push(item);
              }
            });
          }
        }
      } else if (meta.isMap) {
        const map = (this as any)[key] as MapSchema;
        if (map) {
          map.clear();
          if (typeof value === 'object' && value !== null) {
            Object.entries(value).forEach(([k, v]) => {
              if (meta.childType && typeof meta.childType === 'function') {
                // Cast through unknown to avoid abstract class instantiation errors
                const SchemaClass = meta.childType as unknown as new () => Schema;
                const schemaItem = new SchemaClass();
                schemaItem.assign(v as any);
                map.set(k, schemaItem);
              } else {
                map.set(k, v);
              }
            });
          }
        }
      } else if (meta.isSet) {
        const set = (this as any)[key] as SetSchema;
        if (set) {
          set.clear();
          if (Array.isArray(value)) {
            value.forEach((item) => {
              if (meta.childType && typeof meta.childType === 'function') {
                // Cast through unknown to avoid abstract class instantiation errors
                const SchemaClass = meta.childType as unknown as new () => Schema;
                const schemaItem = new SchemaClass();
                schemaItem.assign(item);
                set.add(schemaItem);
              } else {
                set.add(item);
              }
            });
          }
        }
      } else if (meta.isSchema) {
        const schemaValue = (this as any)[key] as Schema;
        if (schemaValue && typeof value === 'object' && value !== null) {
          schemaValue.assign(value);
        } else if (meta.type && typeof meta.type === 'function') {
          // Cast through unknown to avoid abstract class instantiation errors
          const SchemaClass = meta.type as unknown as new () => Schema;
          const newSchema = new SchemaClass();
          newSchema.assign(value);
          (this as any)[key] = newSchema;
        }
      } else {
        // Set primitive value and mark as dirty
        (this as any)[key] = value;
        this._markDirty(key);
      }
    }

    return this;
  }

  /**
   * Create a deep clone of this schema.
   */
  clone(): this {
    const cloned = new (this.constructor as any)() as this;
    cloned.assign(this.toJSON());
    return cloned;
  }

  /**
   * Get the schema class name.
   */
  static getSchemaName(): string {
    const metadata = Reflect.getMetadata(SCHEMA_METADATA_KEY, this);
    return metadata?.name || this.name;
  }

  /**
   * Get property metadata for this schema class.
   */
  static getProperties(): Map<string, PropertyMetadata> {
    return (
      Reflect.getMetadata(SCHEMA_PROPERTIES_KEY, this) ||
      new Map<string, PropertyMetadata>()
    );
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get a schema class from the registry by name.
 */
export function getSchemaClass(name: string): typeof Schema | undefined {
  return schemaRegistry.get(name);
}

/**
 * Register a schema class manually (alternative to @schema decorator).
 */
export function registerSchema(name: string, schemaClass: typeof Schema): void {
  schemaRegistry.set(name, schemaClass);
}

/**
 * Type helper for creating schema instances from plain objects.
 */
export function createSchema<T extends Schema>(
  SchemaClass: new () => T,
  data?: Record<string, any>
): T {
  const instance = new SchemaClass();
  if (data) {
    instance.assign(data);
  }
  return instance;
}
