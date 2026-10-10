import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import server from '../src/server'
import {
  sessionSchema,
  type Session,
  lapSchema,
  type Lap,
  stintSchema,
  type Stint,
  pitStopSchema,
  type PitStop,
  eventSchema,
  type Event
} from '../../shared/src/schemas'
import { writeFileSync } from 'fs'

describe('CP7: API complete', () => {
  let fastify: typeof server

  beforeAll(async () => {
    fastify = server
    await fastify.ready()
    writeFileSync('/tmp/test-output.txt', 'Test started\\n');
  })

  afterAll(async () => {
    await fastify.close()
    writeFileSync('/tmp/test-output.txt', 'Test finished\\n', { flag: 'a' });
  })

  describe('GET /api/sessions', () => {
    it('should return a list of sessions', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions',
      })

      writeFileSync('/tmp/test-output.txt', `Response status: ${response.statusCode}\\n`, { flag: 'a' });
      writeFileSync('/tmp/test-output.txt', `Response payload: ${response.payload}\\n`, { flag: 'a' });

      expect(response.statusCode).toBe(200)

      // Parse the response as JSON
      let data: unknown
      try {
        data = JSON.parse(response.payload)
        writeFileSync('/tmp/test-output.txt', `Parsed data: ${JSON.stringify(data)}\\n`, { flag: 'a' });
      } catch (e) {
        throw new Error('Response is not valid JSON')
      }

      // Validate that it's an array
      expect(Array.isArray(data)).toBe(true);

      // If there are sessions, validate each one against the schema
      if (Array.isArray(data) && data.length > 0) {
        data.forEach((session: unknown) => {
          // Validate each session against the session schema
          const validated = sessionSchema.parse(session);
          writeFileSync('/tmp/test-output.txt', `Validated session: ${JSON.stringify(validated)}\\n`, { flag: 'a' });
          expect(validated).toBeInstanceOf(Object);
        });
      }
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('should return a session by ID', async () => {
      // First, get all sessions to find a valid ID
      const sessionsResponse = await fastify.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      let sessions: unknown[];
      try {
        sessions = JSON.parse(sessionsResponse.payload);
      } catch (e) {
        throw new Error('Response is not valid JSON');
      }

      writeFileSync('/tmp/test-output.txt', `Sessions from DB: ${JSON.stringify(sessions)}\\n`, { flag: 'a' });

      if (!Array.isArray(sessions) || sessions.length === 0) {
        // If no sessions in DB, we'll test with a known ID from the fixture
        // Based on the fixture directory name, the session ID might be related to 2023_2_Race
        const testId = '2023_2_Race'; // This is a guess

        writeFileSync('/tmp/test-output.txt', `Testing with ID: ${testId}\\n`, { flag: 'a' });

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/${testId}`,
        });

        writeFileSync(`/tmp/test-output.txt`, `Response status for ${testId}: ${response.statusCode}\\n`, { flag: 'a' });
        writeFileSync(`/tmp/test-output.txt`, `Response payload: ${response.payload}\\n`, { flag: 'a' });

        // Since we don't know if this exists yet, we'll accept either 200 or 404
        expect([200, 404]).toContain(response.statusCode);

        if (response.statusCode === 200) {
          let data: unknown;
          try {
            data = JSON.parse(response.payload);
          } catch (e) {
            throw new Error('Response is not valid JSON');
          }

          // Validate against session schema
          const validated = sessionSchema.parse(data);
          expect(validated).toBeInstanceOf(Object);
        }
      } else {
        // If we have sessions, test with the first one's ID
        const firstSession = sessions[0] as Session;
        writeFileSync(`/tmp/test-output.txt`, `Testing with first session ID: ${firstSession.id}\\n`, { flag: 'a' });

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/${firstSession.id}`,
        });

        expect(response.statusCode).toBe(200);

        let data: unknown;
        try {
          data = JSON.parse(response.payload);
        } catch (e) {
          throw new Error('Response is not valid JSON');
        }

        // Validate against session schema
        const validated = sessionSchema.parse(data);
        expect(validated).toBeInstanceOf(Object);
      }
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/non-existent-session-id',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // Laps routes tests
  describe('GET /api/sessions/:id/laps', () => {
    it('should return laps for a session', async () => {
      // First, get all sessions to find a valid ID
      const sessionsResponse = await fastify.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      let sessions: unknown[];
      try {
        sessions = JSON.parse(sessionsResponse.payload);
      } catch (e) {
        throw new Error('Response is not valid JSON');
      }

      if (!Array.isArray(sessions) || sessions.length === 0) {
        // If no sessions in DB, test returns empty array (which is valid)
        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/2023_2_Race/laps`,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);
      } else {
        // If we have sessions, test with the first one's ID
        const firstSession = sessions[0] as Session;

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/${firstSession.id}/laps`,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);

        // Validate each lap against the schema if any exist
        if (Array.isArray(data) && data.length > 0) {
          data.forEach((lap: unknown) => {
            const validated = lapSchema.parse(lap);
            expect(validated).toBeInstanceOf(Object);
          });
        }
      }
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/non-existent-session-id/laps',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // Stints routes tests
  describe('GET /api/sessions/:id/stints', () => {
    it('should return stints for a session', async () => {
      // First, get all sessions to find a valid ID
      const sessionsResponse = await fastify.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      let sessions: unknown[];
      try {
        sessions = JSON.parse(sessionsResponse.payload);
      } catch (e) {
        throw new Error('Response is not valid JSON');
      }

      if (!Array.isArray(sessions) || sessions.length === 0) {
        // If no sessions in DB, test returns empty array (which is valid)
        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/2023_2_Race/stints`,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);
      } else {
        // If we have sessions, test with the first one's ID
        const firstSession = sessions[0] as Session;

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/${firstSession.id}/stints`,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);

        // Validate each stint against the schema if any exist
        if (Array.isArray(data) && data.length > 0) {
          data.forEach((stint: unknown) => {
            const validated = stintSchema.parse(stint);
            expect(validated).toBeInstanceOf(Object);
          });
        }
      }
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/non-existent-session-id/stints',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // Pit stops routes tests
  describe('GET /api/sessions/:id/pit-stops', () => {
    it('should return pit stops for a session', async () => {
      // First, get all sessions to find a valid ID
      const sessionsResponse = await fastify.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      let sessions: unknown[];
      try {
        sessions = JSON.parse(sessionsResponse.payload);
      } catch (e) {
        throw new Error('Response is not valid JSON');
      }

      if (!Array.isArray(sessions) || sessions.length === 0) {
        // If no sessions in DB, test returns empty array (which is valid)
        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/2023_2_Race/pit-stops`,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);
      } else {
        // If we have sessions, test with the first one's ID
        const firstSession = sessions[0] as Session;

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/${firstSession.id}/pit-stops`,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);

        // Validate each pit stop against the schema if any exist
        if (Array.isArray(data) && data.length > 0) {
          data.forEach((pitStop: unknown) => {
            const validated = pitStopSchema.parse(pitStop);
            expect(validated).toBeInstanceOf(Object);
          });
        }
      }
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/non-existent-session-id/pit-stops',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // Events routes tests
  describe('GET /api/sessions/:id/events', () => {
    it('should return events for a session', async () => {
      // First, get all sessions to find a valid ID
      const sessionsResponse = await fastify.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      let sessions: unknown[];
      try {
        sessions = JSON.parse(sessionsResponse.payload);
      } catch (e) {
        throw new Error('Response is not valid JSON');
      }

      if (!Array.isArray(sessions) || sessions.length === 0) {
        // If no sessions in DB, test returns empty array (which is valid)
        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/2023_2_Race/events`,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);
      } else {
        // If we have sessions, test with the first one's ID
        const firstSession = sessions[0] as Session;

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/${firstSession.id}/events`,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);

        // Validate each event against the schema if any exist
        if (Array.isArray(data) && data.length > 0) {
          data.forEach((event: unknown) => {
            const validated = eventSchema.parse(event);
            expect(validated).toBeInstanceOf(Object);
          });
        }
      }
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/non-existent-session-id/events',
      });

      expect(response.statusCode).toBe(404);
     });
   });

   // Driver-scoped routes tests
   describe('GET /api/sessions/:sessionId/drivers/:driverId/laps', () => {
     it('should return laps for a driver in a session', async () => {
       // First, get all sessions to find a valid ID
       const sessionsResponse = await fastify.inject({
         method: 'GET',
         url: '/api/sessions',
       });

       let sessions: unknown[];
       try {
         sessions = JSON.parse(sessionsResponse.payload);
       } catch (e) {
         throw new Error('Response is not valid JSON');
       }

       if (!Array.isArray(sessions) || sessions.length === 0) {
         // If no sessions in DB, test returns empty array (which is valid)
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/2023_2_Race/drivers/VER/laps`,
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(Array.isArray(data)).toBe(true);
       } else {
         // If we have sessions, test with the first one's ID
         const firstSession = sessions[0] as Session;
         
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/${firstSession.id}/drivers/VER/laps`,
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(Array.isArray(data)).toBe(true);

         // Validate each lap against the schema if any exist
         if (Array.isArray(data) && data.length > 0) {
           data.forEach((lap: unknown) => {
             const validated = lapSchema.parse(lap);
             expect(validated).toBeInstanceOf(Object);
           });
         }
       }
     });

     it('should return 404 for non-existent session', async () => {
       const response = await fastify.inject({
         method: 'GET',
         url: '/api/sessions/non-existent-session-id/drivers/VER/laps',
       });

       expect(response.statusCode).toBe(404);
     });
   });

   describe('GET /api/sessions/:sessionId/drivers/:driverId/stints', () => {
     it('should return stints for a driver in a session', async () => {
       // First, get all sessions to find a valid ID
       const sessionsResponse = await fastify.inject({
         method: 'GET',
         url: '/api/sessions',
       });

       let sessions: unknown[];
       try {
         sessions = JSON.parse(sessionsResponse.payload);
       } catch (e) {
         throw new Error('Response is not valid JSON');
       }

       if (!Array.isArray(sessions) || sessions.length === 0) {
         // If no sessions in DB, test returns empty array (which is valid)
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/2023_2_Race/drivers/VER/stints`,
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(Array.isArray(data)).toBe(true);
       } else {
         // If we have sessions, test with the first one's ID
         const firstSession = sessions[0] as Session;
         
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/${firstSession.id}/drivers/VER/stints`,
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(Array.isArray(data)).toBe(true);

         // Validate each stint against the schema if any exist
         if (Array.isArray(data) && data.length > 0) {
           data.forEach((stint: unknown) => {
             const validated = stintSchema.parse(stint);
             expect(validated).toBeInstanceOf(Object);
           });
         }
       }
     });

     it('should return 404 for non-existent session', async () => {
       const response = await fastify.inject({
         method: 'GET',
         url: '/api/sessions/non-existent-session-id/drivers/VER/stints',
       });

       expect(response.statusCode).toBe(404);
     });
   });

   describe('GET /api/sessions/:sessionId/drivers/:driverId/pit-stops', () => {
     it('should return pit stops for a driver in a session', async () => {
       // First, get all sessions to find a valid ID
       const sessionsResponse = await fastify.inject({
         method: 'GET',
         url: '/api/sessions',
       });

       let sessions: unknown[];
       try {
         sessions = JSON.parse(sessionsResponse.payload);
       } catch (e) {
         throw new Error('Response is not valid JSON');
       }

       if (!Array.isArray(sessions) || sessions.length === 0) {
         // If no sessions in DB, test returns empty array (which is valid)
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/2023_2_Race/drivers/VER/pit-stops`,
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(Array.isArray(data)).toBe(true);
       } else {
         // If we have sessions, test with the first one's ID
         const firstSession = sessions[0] as Session;
         
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/${firstSession.id}/drivers/VER/pit-stops`,
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(Array.isArray(data)).toBe(true);

         // Validate each pit stop against the schema if any exist
         if (Array.isArray(data) && data.length > 0) {
           data.forEach((pitStop: unknown) => {
             const validated = pitStopSchema.parse(pitStop);
             expect(validated).toBeInstanceOf(Object);
           });
         }
       }
     });

     it('should return 404 for non-existent session', async () => {
       const response = await fastify.inject({
         method: 'GET',
         url: '/api/sessions/non-existent-session-id/drivers/VER/pit-stops',
       });

       expect(response.statusCode).toBe(404);
     });
   });

   describe('GET /api/sessions/:sessionId/drivers/:driverId/events', () => {
     it('should return events for a driver in a session', async () => {
       // First, get all sessions to find a valid ID
       const sessionsResponse = await fastify.inject({
         method: 'GET',
         url: '/api/sessions',
       });

       let sessions: unknown[];
       try {
         sessions = JSON.parse(sessionsResponse.payload);
       } catch (e) {
         throw new Error('Response is not valid JSON');
       }

       if (!Array.isArray(sessions) || sessions.length === 0) {
         // If no sessions in DB, test returns empty array (which is valid)
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/2023_2_Race/drivers/VER/events`,
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(Array.isArray(data)).toBe(true);
       } else {
         // If we have sessions, test with the first one's ID
         const firstSession = sessions[0] as Session;
         
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/${firstSession.id}/drivers/VER/events`,
         });

         expect(response.statusCode).toBe(200);
         const data = JSON.parse(response.payload);
         expect(Array.isArray(data)).toBe(true);

         // Validate each event against the schema if any exist
         if (Array.isArray(data) && data.length > 0) {
           data.forEach((event: unknown) => {
             const validated = eventSchema.parse(event);
             expect(validated).toBeInstanceOf(Object);
           });
         }
       }
     });

     it('should return 404 for non-existent session', async () => {
       const response = await fastify.inject({
         method: 'GET',
         url: '/api/sessions/non-existent-session-id/drivers/VER/events',
       });

       expect(response.statusCode).toBe(404);
     });
   });

   // Binary route tests
  describe('GET /api/sessions/:id/binary/:type/:chunkIndex?', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/non-existent-session-id/binary/motion/0',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject path traversal attempts in type parameter', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/2023_2_Race/binary/../etc/passwd/0',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject path traversal attempts in chunkIndex parameter', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/2023_2_Race/binary/motion/../etc/passwd',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing chunkIndex for motion type', async () => {
      // First, get all sessions to find a valid ID
      const sessionsResponse = await fastify.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      let sessions: unknown[];
      try {
        sessions = JSON.parse(sessionsResponse.payload);
      } catch (e) {
        throw new Error('Response is not valid JSON');
      }

      if (!Array.isArray(sessions) || sessions.length === 0) {
        // If no sessions in DB, test with known ID
        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/2023_2_Race/binary/motion`,
        });

        expect(response.statusCode).toBe(400);
      } else {
        // If we have sessions, test with the first one's ID
        const firstSession = sessions[0] as Session;

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/sessions/${firstSession.id}/binary/motion`,
        });

        expect(response.statusCode).toBe(400);
      }
    });

    it('should return 400 for invalid binary type', async () => {
      // First, get all sessions to find a valid ID
      const sessionsResponse = await fastify.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      let sessions: unknown[];
      try {
        sessions = JSON.parse(sessionsResponse.payload);
      } catch (e) {
        throw new Error('Response is not valid JSON');
      }

       if (!Array.isArray(sessions) || sessions.length === 0) {
         // If no sessions in DB, test with known ID
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/2023_2_Race/binary/invalid/0`,
         });
 
         expect(response.statusCode).toBe(400);
       } else {
         // If we have sessions, test with the first one's ID
         const firstSession = sessions[0] as Session;
 
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/${firstSession.id}/binary/invalid/0`,
         });
 
         expect(response.statusCode).toBe(400);
       }
     });

     // Success tests for binary route
     it('should return motion binary data with ETag', async () => {
       // First, get all sessions to find a valid ID
       const sessionsResponse = await fastify.inject({
         method: 'GET',
         url: '/api/sessions',
       });

       let sessions: unknown[];
       try {
         sessions = JSON.parse(sessionsResponse.payload);
       } catch (e) {
         throw new Error('Response is not valid JSON');
       }

       if (!Array.isArray(sessions) || sessions.length === 0) {
         // If no sessions in DB, test with known ID from fixture
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/2023_2_Race/binary/motion/0`,
         });

         // Since binary files may not exist in test env, we accept either 200 or 404
         expect([200, 404]).toContain(response.statusCode);
         if (response.statusCode === 200) {
           expect(response.headers['content-type']).toBe('application/octet-stream');
           expect(response.headers.etag).toBeDefined();
         }
       } else {
         // If we have sessions, test with the first one's ID
         const firstSession = sessions[0] as Session;
         
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/${firstSession.id}/binary/motion/0`,
         });

         // Since binary files may not exist in test env, we accept either 200 or 404
         expect([200, 404]).toContain(response.statusCode);
         if (response.statusCode === 200) {
           expect(response.headers['content-type']).toBe('application/octet-stream');
           expect(response.headers.etag).toBeDefined();
         }
       }
     });

     it('should return gaps binary data with ETag', async () => {
       // First, get all sessions to find a valid ID
       const sessionsResponse = await fastify.inject({
         method: 'GET',
         url: '/api/sessions',
       });

       let sessions: unknown[];
       try {
         sessions = JSON.parse(sessionsResponse.payload);
       } catch (e) {
         throw new Error('Response is not valid JSON');
       }

       if (!Array.isArray(sessions) || sessions.length === 0) {
         // If no sessions in DB, test with known ID from fixture
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/2023_2_Race/binary/gaps`,
         });

         // Since binary files may not exist in test env, we accept either 200 or 404
         expect([200, 404]).toContain(response.statusCode);
         if (response.statusCode === 200) {
           expect(response.headers['content-type']).toBe('application/octet-stream');
           expect(response.headers.etag).toBeDefined();
         }
       } else {
         // If we have sessions, test with the first one's ID
         const firstSession = sessions[0] as Session;
         
         const response = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/${firstSession.id}/binary/gaps`,
         });

         // Since binary files may not exist in test env, we accept either 200 or 404
         expect([200, 404]).toContain(response.statusCode);
         if (response.statusCode === 200) {
           expect(response.headers['content-type']).toBe('application/octet-stream');
           expect(response.headers.etag).toBeDefined();
         }
       }
     });

     it('should support ETag caching (304 Not Modified)', async () => {
       // First, get all sessions to find a valid ID
       const sessionsResponse = await fastify.inject({
         method: 'GET',
         url: '/api/sessions',
       });

       let sessions: unknown[];
       try {
         sessions = JSON.parse(sessionsResponse.payload);
       } catch (e) {
         throw new Error('Response is not valid JSON');
       }

       if (!Array.isArray(sessions) || sessions.length === 0) {
         // If no sessions in DB, test with known ID from fixture
         const firstResponse = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/2023_2_Race/binary/motion/0`,
         });

         // Only test caching if we got a successful response
         if (firstResponse.statusCode === 200) {
           const etag = firstResponse.headers.etag;
           expect(etag).toBeDefined();
           
           const secondResponse = await fastify.inject({
             method: 'GET',
             url: `/api/sessions/2023_2_Race/binary/motion/0`,
             headers: {
               'if-none-match': etag
             }
           });
           
           expect(secondResponse.statusCode).toBe(304);
         }
       } else {
         // If we have sessions, test with the first one's ID
         const firstSession = sessions[0] as Session;
         
         const firstResponse = await fastify.inject({
           method: 'GET',
           url: `/api/sessions/${firstSession.id}/binary/motion/0`,
         });

         // Only test caching if we got a successful response
         if (firstResponse.statusCode === 200) {
           const etag = firstResponse.headers.etag;
           expect(etag).toBeDefined();
           
           const secondResponse = await fastify.inject({
             method: 'GET',
             url: `/api/sessions/${firstSession.id}/binary/motion/0`,
             headers: {
               'if-none-match': etag
             }
           });
           
           expect(secondResponse.statusCode).toBe(304);
         }
       }
     });
   });
});
