# Project Time Tracker

A full-stack project management and time tracking application built on Zoho Catalyst with an interactive Gantt chart.

## Features

- Project management (CRUD, soft delete)
- Team members with role-based permissions (Owner/Manager/Member/Viewer)
- Task management with status, priority, assignee, dates
- Interactive Gantt chart (drag, resize, progress, dependencies, milestones)
- Time logging with auto-calculation
- Personal timelog dashboard with daily summary
- Zoho SSO authentication
- Server-side permission enforcement on all 19 API endpoints

## Tech Stack

- **Backend**: Zoho Catalyst Serverless Functions (Node.js 18)
- **Frontend**: React + Vite + Ant Design
- **Database**: Catalyst Data Store
- **Auth**: Zoho SSO
- **Gantt**: gantt-task-react

## Setup

See deployment instructions in the codebase.