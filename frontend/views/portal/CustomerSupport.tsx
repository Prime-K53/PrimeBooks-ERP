import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Phone, Mail, Clock, MessageCircle } from 'lucide-react';
import PortalPageHeader from './components/PortalPageHeader';

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
    <div style={{ background: '#FEFDFB', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 28px 18px',
        borderBottom: '1px solid #e4ddd1',
        background: '#FEFDFB'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(155deg, #1f8577, #0f544c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
          }}>
            <MessageCircle size={19} color="#fff" />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', 'Georgia', serif", fontWeight: 400,
              fontSize: 22, margin: 0, color: '#0b3e39', letterSpacing: 0.2
            }}>
              Support
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#5c6567', letterSpacing: 0.02 }}>
              Get help with your account
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '32px 28px' }}>
        <div style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          borderRadius: 14,
          border: '1.4px solid #e4ddd1',
          padding: '28px 30px',
          maxWidth: 720
        }}>
          <h2 style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 22,
            fontWeight: 600,
            color: '#23282A',
            margin: '0 0 6px',
            lineHeight: 1.4
          }}>
            THANK YOU!!
          </h2>
          <p style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 13.5,
            color: '#5c6567',
            margin: '0 0 28px',
            lineHeight: 1.5
          }}>
            For choosing us, we are committed to your satisfaction and welcome your feedback.
            We'll do all we can to make your experience positive. Contact us:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {contactItems.map((item, index) => (
              <div key={index} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                padding: '10px 12px',
                background: '#fff',
                borderRadius: 10,
                border: '1.4px solid #e4ddd1',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 8,
                  background: '#eef7f6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  color: '#1f8577'
                }}>
                  <item.icon size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: '#5c6567',
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
                    color: '#23282A',
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
            background: '#fff',
            borderRadius: 10,
            border: '1.4px solid #e4ddd1',
          }}>
            <div style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 11.5,
              fontWeight: 600,
              color: '#5c6567',
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
              color: '#5c6567',
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
                color: '#1f8577',
                textDecoration: 'none',
                lineHeight: 1.45,
                wordBreak: 'break-all'
              }}
            >
              Open in Google Maps →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerSupport;
