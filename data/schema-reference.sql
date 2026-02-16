-- Schema Reference (documentation only)
-- Tables must be created manually in Catalyst Console > Data Store
-- Catalyst auto-provides: ROWID, CREATEDTIME, MODIFIEDTIME

-- Table: users
--   name           Text(500)
--   email          Text(500)
--   global_role    Text(50)      default 'Member'
--   avatar_url     Text(1000)
--   is_active      Boolean       default true

-- Table: projects
--   name           Text(500)
--   description    Text(5000)
--   status         Text(50)      Active | OnHold | Completed | Archived
--   created_by_id  Bigint        FK users.ROWID
--   start_date     Text(20)      YYYY-MM-DD
--   end_date       Text(20)      YYYY-MM-DD
--   is_deleted     Boolean       default false

-- Table: project_members
--   project_id     Bigint        FK projects.ROWID
--   user_id        Bigint        FK users.ROWID
--   role           Text(50)      Owner | Manager | Member | Viewer

-- Table: tasks
--   project_id     Bigint        FK projects.ROWID
--   title          Text(500)
--   description    Text(5000)
--   status         Text(50)      Todo | InProgress | InReview | Done
--   priority       Text(50)      Low | Medium | High | Critical
--   assignee_id    Bigint        FK users.ROWID nullable
--   created_by_id  Bigint        FK users.ROWID
--   start_date     Text(20)      YYYY-MM-DD
--   end_date       Text(20)      YYYY-MM-DD
--   progress       Int           0-100
--   depends_on     Text(2000)    comma-separated task ROWIDs
--   sort_order     Int
--   milestone      Boolean
--   is_deleted     Boolean       default false

-- Table: time_logs
--   task_id        Bigint        FK tasks.ROWID
--   user_id        Bigint        FK users.ROWID
--   log_date       Text(20)      YYYY-MM-DD
--   start_time     Text(10)      HH:MM
--   end_time       Text(10)      HH:MM
--   minutes        Int
--   notes          Text(2000)
