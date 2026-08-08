import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Phone, Mail, Clock, MessageCircle } from 'lucide-react';
import PortalPageHeader from './components/PortalPageHeader';
import PortalCard from './components/PortalCard';
import { portalTheme } from './constants';

const CustomerSupport: React.FC = () => {
  const navigate = useNavigate();

  const contactItems = [
    { icon: Phone, label: 'Customer Support', value: '+265 992 528 222' },
    { icon: Mail, label: 'Sales Email', value: 'info.primemw@gmail.com' },
    { icon: Mail, label: 'Support Email', value: 'chiwaturhonald@gmail.com' },
    { icon: MessageCircle, label: 'WhatsApp', value: '+265 992 528 222' },
    { icon: Clock, label: 'Business Hours', value: 'Monday–Friday, 8:00 AM–5:00 PM' },
    { icon: MapPin, label: 'Office Address', value: 'Along M5 road Mtakataka, Malawi' },
  ];

  return (
    <div>
      <PortalPageHeader title="Support" subtitle="Get help with your account" icon={MessageCircle} />

      <div style={{ padding: '28px 20px' }}>
        <PortalCard>
          <div style={{
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
            borderRadius: 16,
            border: `1px solid ${portalTheme.border}`,
            padding: '28px 30px',
            maxWidth: 720
          }}>
            <h2 style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 22,
              fontWeight: 600,
              color: portalTheme.ink,
              margin: '0 0 6px',
              lineHeight: 1.4
            }}>
              THANK YOU!!
            </h2>
            <p style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              color: portalTheme.inkSoft,
              margin: '0 0 28px',
              lineHeight: 1.5
            }}>
              For choosing us, we are committed to your satisfaction and welcome our feedback.
              We'll do all we can to make your experience positive. Contact us:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {contactItems.map((item, index) => (
                <div key={index} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  padding: '12px 14px',
                  background: '#FFFFFF',
                  borderRadius: 12,
                  border: `1px solid ${portalTheme.border}`,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: portalTheme.teal[50],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    color: portalTheme.teal[600]
                  }}>
                    <item.icon size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: portalTheme.inkMuted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: 2,
                      lineHeight: 1.4
                    }}>
                      {item.label}
                    </div>
                    <div style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: portalTheme.ink,
                      lineHeight: 1.45,
                      wordBreak: 'break-word'
                    }}>
                      {item.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: 24,
              padding: '14px 16px',
              background: '#FFFFFF',
              borderRadius: 12,
              border: `1px solid ${portalTheme.border}`,
            }}>
              <div style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 11.5,
                fontWeight: 600,
                color: portalTheme.inkMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 6,
                lineHeight: 1.4
              }}>
                Google Map
              </div>
              <div style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: portalTheme.inkSoft,
                marginBottom: 6,
                lineHeight: 1.45
              }}>
                QGF8+3J Mtakataka
              </div>
              <a
                href="https://www.google.com/maps/search/?api=1&query=Prime+Printing+%26+Stationery+Mtakataka+Malawi&utm_source=chatgpt.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  color: portalTheme.teal[600],
                  textDecoration: 'none',
                  lineHeight: 1.45,
                  wordBreak: 'break-all'
                }}
              >
                Open in Google Maps →
              </a>
            </div>
          </div>
        </PortalCard>
      </div>
    </div>
  );
};

export default CustomerSupport;
