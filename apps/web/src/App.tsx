import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth';
import Layout from './components/Layout';
import GameResults from './pages/GameResults';
import Games from './pages/Games';
import Host from './pages/Host';
import Login from './pages/Login';
import Play from './pages/Play';
import TestPlay from './pages/TestPlay';
import TestDashboard from './pages/TestDashboard';
import ClassesPage from './classes/ClassesPage';
import ClassDetail from './classes/ClassDetail';
import StudentProfile from './classes/StudentProfile';
import CodePage from './pages/CodePage';
import QuizReview from './pages/QuizReview';
import Quizzes from './pages/Quizzes';
import Tokens from './pages/Tokens';

const DesignPage = lazy(() => import('./pages/DesignPage'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/play" element={<Play />} />
      <Route path="/test" element={<TestPlay />} />
      <Route path="/kod" element={<CodePage />} />
      <Route
        path="/_design"
        element={
          <Suspense fallback={null}>
            <DesignPage />
          </Suspense>
        }
      />
      <Route path="/host/:gameId" element={<Host />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/quizzes" replace />} />
        <Route path="/quizzes" element={<Quizzes />} />
        <Route path="/quizzes/:id" element={<QuizReview />} />
        <Route path="/games" element={<Games />} />
        <Route path="/games/:id" element={<GameResults />} />
        <Route path="/tests/:id" element={<TestDashboard />} />
        <Route path="/classes" element={<ClassesPage />} />
        <Route path="/classes/:id" element={<ClassDetail />} />
        <Route path="/classes/:id/students/:sid" element={<StudentProfile />} />
        <Route path="/settings/tokens" element={<Tokens />} />
      </Route>
      <Route path="*" element={<Navigate to="/quizzes" replace />} />
    </Routes>
  );
}
