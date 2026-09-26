import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth';
import { ErrorBoundary, NotFound } from './pages/ErrorPages';
import { PageSkeleton } from './ui/Feedback';

// Every route is its own chunk: a phone downloads the shell plus the one student screen it opens, and
// nothing of the teacher's app or the projector (V11.2; pnpm check:budgets measures each student route).
const Play = lazy(() => import('./pages/Play'));
const TestPlay = lazy(() => import('./pages/TestPlay'));
const CodePage = lazy(() => import('./pages/CodePage'));
const Layout = lazy(() => import('./components/Layout'));
const Login = lazy(() => import('./pages/Login'));
const Host = lazy(() => import('./pages/Host'));
const Quizzes = lazy(() => import('./pages/Quizzes'));
const QuizReview = lazy(() => import('./pages/QuizReview'));
const Games = lazy(() => import('./pages/Games'));
const GameResults = lazy(() => import('./pages/GameResults'));
const TestDashboard = lazy(() => import('./pages/TestDashboard'));
const ClassesPage = lazy(() => import('./classes/ClassesPage'));
const ClassDetail = lazy(() => import('./classes/ClassDetail'));
const StudentProfile = lazy(() => import('./classes/StudentProfile'));
const Tokens = lazy(() => import('./pages/Tokens'));
const LookSettings = lazy(() => import('./pages/LookSettings'));
const DesignPage = lazy(() => import('./pages/DesignPage'));

const page = (el: ReactNode) => <Suspense fallback={<PageSkeleton />}>{el}</Suspense>;

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
      <Route path="/login" element={page(<Login />)} />
      <Route path="/play" element={page(<Play />)} />
      <Route path="/test" element={page(<TestPlay />)} />
      <Route path="/kod" element={page(<CodePage />)} />
      <Route
        path="/_design"
        element={
          <Suspense fallback={null}>
            <DesignPage />
          </Suspense>
        }
      />
      <Route path="/host/:gameId" element={page(<Host />)} />
      <Route
        element={
          <RequireAuth>
            {page(<Layout />)}
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/quizzes" replace />} />
        <Route path="/quizzes" element={page(<Quizzes />)} />
        <Route path="/quizzes/:id" element={page(<QuizReview />)} />
        <Route path="/games" element={page(<Games />)} />
        <Route path="/games/:id" element={page(<GameResults />)} />
        <Route path="/tests/:id" element={page(<TestDashboard />)} />
        <Route path="/classes" element={page(<ClassesPage />)} />
        <Route path="/classes/:id" element={page(<ClassDetail />)} />
        <Route path="/classes/:id/students/:sid" element={page(<StudentProfile />)} />
        <Route path="/settings/tokens" element={page(<Tokens />)} />
        <Route path="/settings/look" element={page(<LookSettings />)} />
      </Route>
      <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  );
}
