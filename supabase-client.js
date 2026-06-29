/**
 * Supabase Cloud Storage Client for Gantt Viewer
 * Handles project CRUD operations with Supabase
 */
const SupabaseStore = (() => {
  'use strict';

  const SUPABASE_URL = 'https://gmyaelzikjbvnbmiiqjh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdteWFlbHppa2pidm5ibWlpcWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2OTc2NjgsImV4cCI6MjA5ODI3MzY2OH0.1x0derhtdxKStXjKnRKqjeSnnKVx-7pNu4PwO9BfYVI';

  let supabase = null;
  let syncTimer = null;
  let syncStatus = 'idle'; // 'idle' | 'syncing' | 'synced' | 'error'
  let onStatusChange = null;

  function init() {
    try {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('☁️ Supabase connected');
      return true;
    } catch (e) {
      console.warn('☁️ Supabase init failed:', e);
      return false;
    }
  }

  function isReady() {
    return supabase !== null;
  }

  function setStatusCallback(cb) {
    onStatusChange = cb;
  }

  function _setStatus(status) {
    syncStatus = status;
    if (onStatusChange) onStatusChange(status);
  }

  // List all projects (name, id, updated_at)
  async function listProjects() {
    if (!supabase) return [];
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('☁️ List projects failed:', e);
      return [];
    }
  }

  // Load a single project by ID
  async function loadProject(id) {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn('☁️ Load project failed:', e);
      return null;
    }
  }

  // Load a project by name
  async function loadProjectByName(name) {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('name', name)
        .single();
      if (error) throw error;
      return data;
    } catch (e) {
      return null;
    }
  }

  // Save (upsert) a project — if cloudId exists, update; otherwise insert
  async function saveProject(name, jsonData, cloudId) {
    if (!supabase) return null;
    _setStatus('syncing');
    try {
      let result;
      if (cloudId) {
        // Update existing
        const { data, error } = await supabase
          .from('projects')
          .update({ name, data: jsonData })
          .eq('id', cloudId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        // Check if project with same name exists
        const existing = await loadProjectByName(name);
        if (existing) {
          // Update existing by name
          const { data, error } = await supabase
            .from('projects')
            .update({ data: jsonData })
            .eq('id', existing.id)
            .select()
            .single();
          if (error) throw error;
          result = data;
        } else {
          // Insert new
          const { data, error } = await supabase
            .from('projects')
            .insert({ name, data: jsonData })
            .select()
            .single();
          if (error) throw error;
          result = data;
        }
      }
      _setStatus('synced');
      return result;
    } catch (e) {
      console.warn('☁️ Save failed:', e);
      _setStatus('error');
      return null;
    }
  }

  // Debounced save — call this frequently, it batches into 3-second intervals
  function debouncedSave(name, jsonData, cloudId) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const result = await saveProject(name, jsonData, cloudId);
      return result;
    }, 3000);
  }

  // Delete a project
  async function deleteProject(id) {
    if (!supabase) return false;
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('☁️ Delete failed:', e);
      return false;
    }
  }

  function getStatus() {
    return syncStatus;
  }

  return {
    init,
    isReady,
    listProjects,
    loadProject,
    loadProjectByName,
    saveProject,
    debouncedSave,
    deleteProject,
    getStatus,
    setStatusCallback,
  };
})();
