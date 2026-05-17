// permission-service.js
// Centralized permission evaluation for Excel Overlay.
(function registerPermissionService(globalScope) {
  if (typeof globalScope.createPermissionService === 'function') return;

  const SYSTEM_FIELD_TYPES = new Set([
    'RECORD_NUMBER',
    'CREATED_TIME',
    'UPDATED_TIME',
    'CREATOR',
    'MODIFIER',
    'STATUS',
    'STATUS_ASSIGNEE',
    'CALC',
    'REFERENCE_TABLE'
  ]);

  const EDITABLE_FIELD_TYPES = new Set([
    'SINGLE_LINE_TEXT',
    'MULTI_LINE_TEXT',
    'NUMBER',
    'DATE',
    'LINK',
    'DROP_DOWN',
    'RADIO_BUTTON',
    'CHECK_BOX',
    'MULTI_SELECT',
    'FILE'
  ]);

  function toTrimmedString(value) {
    return String(value == null ? '' : value).trim();
  }

  function toBoolean(value, fallback = null) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'allow', 'allowed'].includes(normalized)) return true;
      if (['false', '0', 'no', 'deny', 'denied'].includes(normalized)) return false;
    }
    return fallback;
  }

  function normalizeFieldMeta(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const code = toTrimmedString(raw.code);
    const type = toTrimmedString(raw.type);
    if (!code || !type) return null;
    const normalized = {
      code,
      type,
      label: toTrimmedString(raw.label),
      required: Boolean(raw.required),
      lookup: raw.lookup && typeof raw.lookup === 'object' ? { ...raw.lookup } : null,
      lookupAuto: Boolean(raw.lookupAuto),
      choices: Array.isArray(raw.choices) ? raw.choices.map((item) => String(item)) : [],
      subtable: null
    };
    if (raw.subtable && typeof raw.subtable === 'object' && Array.isArray(raw.subtable.fields)) {
      normalized.subtable = {
        fields: raw.subtable.fields
          .map((child) => normalizeFieldMeta(child))
          .filter(Boolean)
      };
    }
    return normalized;
  }

  function normalizeAclEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = toTrimmedString(raw.id ?? raw.recordId ?? raw.record?.id ?? raw.record?.recordId);
    if (!id) return null;
    const record = raw.record && typeof raw.record === 'object' ? raw.record : raw;
    const viewable = toBoolean(record.viewable ?? record.view, null);
    const editable = toBoolean(record.editable ?? record.edit, null);
    const deletable = toBoolean(record.deletable ?? record.delete, null);
    const fieldsRaw = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};
    const fields = {};
    if (Array.isArray(fieldsRaw)) {
      fieldsRaw.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const code = toTrimmedString(item.code ?? item.fieldCode);
        if (!code) return;
        const fieldEditable = toBoolean(item.editable ?? item.edit, null);
        if (fieldEditable === null) return;
        fields[code] = { editable: fieldEditable };
      });
    } else {
      Object.keys(fieldsRaw).forEach((key) => {
        const code = toTrimmedString(key);
        if (!code) return;
        const value = fieldsRaw[key];
        const fieldEditable = toBoolean(value?.editable ?? value?.edit ?? value, null);
        if (fieldEditable === null) return;
        fields[code] = { editable: fieldEditable };
      });
    }
    return {
      id,
      viewable,
      editable,
      deletable,
      fields
    };
  }

  function normalizeAppPermission(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const editable = toBoolean(source.editable ?? source.edit ?? source.canEdit, false);
    const addable = toBoolean(source.addable ?? source.add ?? source.canAdd, editable);
    const deletable = toBoolean(source.deletable ?? source.delete ?? source.canDelete, editable);
    return {
      editable,
      addable,
      deletable,
      source: toTrimmedString(source.source) || 'unknown'
    };
  }

  function createPermissionService(options = {}) {
    let debug = Boolean(options.debug);
    let fieldMap = new Map();
    let aclMap = new Map();
    let pendingDeleteIds = new Set();
    let appPermission = normalizeAppPermission(options.appPermission);

    function debugLog(message, payload) {
      if (!debug) return;
      try {
        console.debug(`[permission-service] ${message}`, payload || {});
      } catch (_err) {
        // noop
      }
    }

    function setDebug(next) {
      debug = Boolean(next);
    }

    function setFields(fields) {
      fieldMap = new Map();
      (Array.isArray(fields) ? fields : []).forEach((field) => {
        const normalized = normalizeFieldMeta(field);
        if (!normalized) return;
        fieldMap.set(normalized.code, normalized);
      });
    }

    function refreshRecordAcl(rawAcl) {
      aclMap = new Map();
      (Array.isArray(rawAcl) ? rawAcl : []).forEach((entry) => {
        const normalized = normalizeAclEntry(entry);
        if (!normalized) return;
        aclMap.set(normalized.id, normalized);
      });
    }

    function upsertRecordAcl(entry) {
      const normalized = normalizeAclEntry(entry);
      if (!normalized) return;
      aclMap.set(normalized.id, normalized);
    }

    function removeRecordAcl(recordId) {
      const key = toTrimmedString(recordId);
      if (!key) return;
      aclMap.delete(key);
      pendingDeleteIds.delete(key);
    }

    function clearRecordAcl() {
      aclMap.clear();
      pendingDeleteIds.clear();
    }

    function setPendingDeletes(ids) {
      pendingDeleteIds = new Set((Array.isArray(ids) ? ids : []).map((id) => toTrimmedString(id)).filter(Boolean));
    }

    function setAppPermission(next) {
      appPermission = normalizeAppPermission(next);
    }

    function init(params = {}) {
      if (Object.prototype.hasOwnProperty.call(params, 'debug')) {
        setDebug(params.debug);
      }
      if (Object.prototype.hasOwnProperty.call(params, 'fields')) {
        setFields(params.fields);
      }
      if (Object.prototype.hasOwnProperty.call(params, 'acl')) {
        refreshRecordAcl(params.acl);
      }
      if (Object.prototype.hasOwnProperty.call(params, 'pendingDeleteIds')) {
        setPendingDeletes(params.pendingDeleteIds);
      }
      if (Object.prototype.hasOwnProperty.call(params, 'appPermission')) {
        setAppPermission(params.appPermission);
      }
      debugLog('initialized', {
        fields: fieldMap.size,
        acl: aclMap.size,
        pendingDeletes: pendingDeleteIds.size,
        appPermission
      });
    }

    function getField(fieldCode) {
      const key = toTrimmedString(fieldCode);
      if (!key) return null;
      return fieldMap.get(key) || null;
    }

    function getRecordAcl(recordId) {
      const key = toTrimmedString(recordId);
      if (!key) return null;
      return aclMap.get(key) || null;
    }

    function isSystemField(field) {
      if (!field) return true;
      const type = toTrimmedString(field.type);
      return SYSTEM_FIELD_TYPES.has(type);
    }

    function isLookupField(field) {
      if (!field) return false;
      const type = toTrimmedString(field.type);
      if (type === 'LOOKUP') return true;
      return Boolean(field.lookup);
    }

    function isFieldTypeEditable(field) {
      if (!field) return false;
      const type = toTrimmedString(field.type);
      if (!EDITABLE_FIELD_TYPES.has(type)) return false;
      if (type === 'SUBTABLE') return false;
      return true;
    }

    function canAddRow() {
      return Boolean(appPermission.editable && appPermission.addable);
    }

    function getRecordPermission(recordId) {
      const key = toTrimmedString(recordId);
      if (!appPermission.editable) {
        return { editable: false, deletable: false, reason: 'app_readonly' };
      }
      if (!key) {
        return { editable: false, deletable: false, reason: 'no_acl' };
      }
      if (key.startsWith('NEW:')) {
        const editable = canAddRow();
        return {
          editable,
          deletable: editable,
          reason: editable ? null : 'app_readonly'
        };
      }
      const acl = getRecordAcl(key);
      if (!acl) {
        return { editable: false, deletable: false, reason: 'no_acl' };
      }
      if (pendingDeleteIds.has(key)) {
        return { editable: false, deletable: false, reason: 'status_locked' };
      }
      if (acl.editable === false) {
        return { editable: false, deletable: false, reason: 'record_readonly' };
      }
      const deletable = Boolean(appPermission.deletable && acl.deletable === true);
      return {
        editable: acl.editable === true,
        deletable,
        reason: acl.editable === true ? null : 'record_readonly'
      };
    }

    function canEditRecord(recordId) {
      return getRecordPermission(recordId).editable;
    }

    function canDeleteRecord(recordId) {
      return getRecordPermission(recordId).deletable;
    }

    function getCellPermission(recordId, fieldCode) {
      const field = getField(fieldCode);
      if (!field) return { editable: false, reason: 'unknown_field' };
      if (isSystemField(field)) return { editable: false, reason: 'system_field' };
      if (toTrimmedString(field.type) === 'SUBTABLE') return { editable: false, reason: 'field_readonly' };
      if (isLookupField(field) || field.lookupAuto) return { editable: false, reason: 'lookup_readonly' };
      if (!isFieldTypeEditable(field)) return { editable: false, reason: 'field_readonly' };

      const recordPerm = getRecordPermission(recordId);
      if (!recordPerm.editable) {
        return { editable: false, reason: recordPerm.reason || 'record_readonly' };
      }

      const key = toTrimmedString(recordId);
      if (key && !key.startsWith('NEW:')) {
        const acl = getRecordAcl(key);
        if (!acl) return { editable: false, reason: 'no_acl' };
        const fieldAcl = acl.fields && acl.fields[field.code] ? acl.fields[field.code] : null;
        if (fieldAcl && fieldAcl.editable === false) {
          return { editable: false, reason: 'field_readonly' };
        }
      }
      return { editable: true, reason: null };
    }

    function canEditCell(recordId, fieldCode) {
      return getCellPermission(recordId, fieldCode).editable;
    }

    function filterPasteTargets(targets) {
      const applicable = [];
      const skipped = [];
      (Array.isArray(targets) ? targets : []).forEach((target) => {
        const recordId = toTrimmedString(target?.recordId);
        const fieldCode = toTrimmedString(target?.fieldCode);
        if (!recordId || !fieldCode) {
          skipped.push({ ...target, recordId, fieldCode, reason: 'unknown_field' });
          return;
        }
        const permission = getCellPermission(recordId, fieldCode);
        if (!permission.editable) {
          skipped.push({ ...target, recordId, fieldCode, reason: permission.reason || 'field_readonly' });
          return;
        }
        applicable.push(target);
      });
      return { applicable, skipped };
    }

    return {
      init,
      setDebug,
      setFields,
      setAppPermission,
      setPendingDeletes,
      refreshRecordAcl,
      upsertRecordAcl,
      removeRecordAcl,
      clearRecordAcl,
      getRecordAcl,
      canEditRecord,
      canDeleteRecord,
      canAddRow,
      canEditCell,
      getCellPermission,
      getRecordPermission,
      filterPasteTargets,
      isSystemField,
      isLookupField,
      isFieldTypeEditable
    };
  }

  globalScope.createPermissionService = createPermissionService;
})(globalThis);
