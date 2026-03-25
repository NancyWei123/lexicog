CREATE TABLE IF NOT EXISTS lexical_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_format TEXT NOT NULL COLLATE NOCASE,
    source_language TEXT NOT NULL,
    target_language TEXT NOT NULL,
    analysis TEXT NOT NULL,
    
    is_marked INTEGER NOT NULL DEFAULT 0 CHECK (is_marked IN (0, 1)),
    marked_at DATETIME,
    
    repetition_count INTEGER NOT NULL DEFAULT 0,
    easiness_factor REAL NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    next_review_at DATETIME,
    last_reviewed_at DATETIME,
    
    recent_errors TEXT NOT NULL DEFAULT '[]',
    
    learning_notes TEXT,
    
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    
    CONSTRAINT unique_entry UNIQUE (normalized_format, target_language),
    CONSTRAINT check_marked CHECK (
        (is_marked = 0 AND marked_at IS NULL) OR 
        (is_marked = 1 AND marked_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS llm_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    api_key TEXT NOT NULL,
    api_base_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_time DATETIME NOT NULL,
    session TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS representative_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    model_id           TEXT NOT NULL,
    discipline         TEXT NOT NULL,
    source_language    TEXT NOT NULL,
    list               TEXT NOT NULL,
    CONSTRAINT unique_example UNIQUE (source_language, discipline)
);
