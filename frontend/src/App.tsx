import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import AppLayout from '@cloudscape-design/components/app-layout';
import TopNavigation from '@cloudscape-design/components/top-navigation';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MFASetup from './pages/MFASetup';

function AppContent() {
  const { user } = useAuth();
  const [navigationOpen, setNavigationOpen] = useState(false);


  const topNavigationProps = {
    identity: {
      href: '/',
      title: 'MFA Migration System'
    },
    utilities: user ? [
      {
        type: 'menu-dropdown' as const,
        text: user.username,
        description: user.email,
        iconName: 'user-profile' as const,
        items: [
          {
            id: 'signout',
            text: 'Sign out'
          }
        ]
      }
    ] : []
  };

  const sideNavigationProps = {
    activeHref: window.location.pathname,
    header: { text: 'Navigation', href: '/' },
    items: [
      { type: 'link' as const, text: 'Dashboard', href: '/' },
      { type: 'link' as const, text: 'MFA Setup', href: '/mfa-setup' },
      { type: 'divider' as const },
      { type: 'link' as const, text: 'Settings', href: '/settings' }
    ]
  };

  if (!user) {
    return (
      <>
        <TopNavigation 
          identity={{
            href: '/',
            title: 'MFA Migration System'
          }}
          utilities={[]}
        />
        <Login />
      </>
    );
  }

  return (
    <>
      <TopNavigation {...topNavigationProps} />
      <AppLayout
        navigation={<SideNavigation {...sideNavigationProps} />}
        navigationOpen={navigationOpen}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        content={
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/mfa-setup" element={<MFASetup />} />
          </Routes>
        }
      />
    </>
  );
}

function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 100);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        Loading...
      </div>
    );
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;